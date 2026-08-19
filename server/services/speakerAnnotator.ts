/**
 * 说话人标注工具（server-only）
 *
 * 背景：音频+NLS 识别出的对话文本与用户上传文本常混在一起、无角色标记。
 * 在 DeepSeek 内容审核通过后，调用 DeepSeek 判定是否为对话；若是，则输出按角色标注
 * 合并后的文本。结果只落 `speaker_annotated` 供展示/人工「采用」，不自动改写正文。
 */
import { serverFetch } from '#server/utils/request'
import { logCloudServiceCall } from '#server/utils/cloudServiceLog'
import { withQueue } from './serviceQueue'

export interface SpeakerAnnotateResult {
  /** 是否判定为对话（多角色） */
  dialogue: boolean
  /** 角色标注后的合并文本；非对话或缺标注时为 null */
  annotated: string | null
  /** 是否因原文已含说话人标记而跳过 DeepSeek 标注；默认 false */
  skipped: boolean
}

interface DeepSeekConfig {
  apiKey: string
  model: string
  baseUrl: string
}

const SYSTEM_PROMPT = `你是一个英语学习材料编辑。你会收到一段音频转写与上传文本（可能混在一起、没有说话人标记）。
请判断这是否为多角色的对话材料：
- 如果是对话，请把文本按说话人拆分开并按角色标注（如 "A: ...\nB: ..."），保持英文原文与顺序不变，只做角色标注，不增删内容；输出 JSON {"dialogue": true, "annotated": "标注后的文本"}
- 如果不是对话（单人称/解说/独白），输出 JSON {"dialogue": false, "annotated": null}
只返回 JSON，不要返回任何其他内容。`

/**
 * 行首形如 `<短标签>: 内容`（如 `A: ...` / `Tom: ...` / `Teacher: ...`）
 * 的说话人/角色标记行。纯函数、无副作用，供单元测试。
 */
const LABEL_LINE_RE = /^\s*([A-Za-z\u4e00-\u9fa5_]{1,16})\s*[:：]\s*\S/gm

/**
 * 检测上传原文是否已自带说话人/角色标记（对话）。
 *
 * 启发式（保守、避免误报）：扫描文本行，凡行首为「短标签 + 冒号」即计为一个被标记行，
 * 当出现至少 2 个不同标签时判定为已标注对话。单一标签/旁白/解说样式（如仅一行
 * `Note: ...`、`Introduction:`）不会触发，从而留给 DeepSeek 判定。
 * 纯函数、无副作用、无网络调用，便于单元测试。
 */
export function hasExistingSpeakerMarks(text: string): boolean {
  if (!text) return false
  const labels = new Set<string>()
  for (const m of text.matchAll(LABEL_LINE_RE)) {
    labels.add(m[1]!.trim().toLowerCase())
  }
  return labels.size >= 2
}

/**
 * 判定并标注说话人
 * @param transcript NLS 转写文本
 * @param text       用户上传文本
 * @returns { dialogue, annotated, skipped }；判定非对话或标注为空时 annotated 为 null；
 *          原文已含说话人标记时 skipped 为 true（不调 DeepSeek、不重复标注）
 */
export async function annotateSpeakers(
  transcript: string,
  text: string,
): Promise<SpeakerAnnotateResult> {
  // 预检短路：原文已自带说话人标记，直接跳过 DeepSeek 调用与重复标注
  if (hasExistingSpeakerMarks(text)) {
    return { dialogue: true, annotated: null, skipped: true }
  }

  const config = useRuntimeConfig()
  const ds = config.deepseek as unknown as DeepSeekConfig
  if (!ds?.apiKey || !ds?.baseUrl || !ds?.model) {
    logger.error('[speakerAnnotate] DeepSeek 配置不完整')
    return { dialogue: false, annotated: null, skipped: false }
  }

  const url = `${ds.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const userMsg = `音频转写：\n${transcript}\n\n上传文本：\n${text}`

  try {
    const resp = await withQueue('deepseek', () => {
      return serverFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ds.apiKey}`,
        },
        body: JSON.stringify({
          model: ds.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
        timeout: 20000,
        tag: '[speakerAnnotate]',
      })
    })

    if (!resp.ok) {
      logger.error(`[speakerAnnotate] API 返回 ${resp.status}`)
      void logCloudServiceCall({
        service: 'deepseek',
        operation: 'speakerAnnotate',
        success: false,
        errorMessage: `HTTP ${resp.status}`,
        durationMs: 0,
      })
      return { dialogue: false, annotated: null, skipped: false }
    }
    const data = await resp.json()
    void logCloudServiceCall({
      service: 'deepseek',
      operation: 'speakerAnnotate',
      success: true,
      durationMs: 0,
    })
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const cleaned = content
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      logger.error('[speakerAnnotate] JSON 解析失败')
      return { dialogue: false, annotated: null, skipped: false }
    }
    const dialogue = parsed.dialogue === true
    const annotated =
      typeof parsed.annotated === 'string' && parsed.annotated.trim()
        ? parsed.annotated.trim()
        : null
    return { dialogue, annotated, skipped: false }
  } catch (err) {
    void logCloudServiceCall({
      service: 'deepseek',
      operation: 'speakerAnnotate',
      success: false,
      errorMessage: String(err).substring(0, 500),
      durationMs: 0,
    })
    logger.error('[speakerAnnotate] 调用失败:', err)
    return { dialogue: false, annotated: null, skipped: false }
  }
}
