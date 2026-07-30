/**
 * 文本内容审核工具
 *
 * 调用 DeepSeek API（OpenAI 兼容格式）对文本进行合规性审核。
 * 纯工具函数，零耦合，仅依赖 Nuxt runtimeConfig 中的 DeepSeek 配置。
 */

import { serverFetch } from '#server/utils/request'
import { logCloudServiceCall } from '#server/utils/cloudServiceLog'
import { withQueue } from './serviceQueue'

export interface ModerationResult {
  /** 是否合规 */
  safe: boolean
  /** 不合规的原因，合规时为 null */
  reason: string | null
}

/** DeepSeek 配置结构（对应 runtimeConfig.deepseek） */
interface DeepSeekConfig {
  apiKey: string
  model: string
  baseUrl: string
}

const SYSTEM_PROMPT = `你是一个内容审核助手。你需要对用户提交的英文学习材料文本进行审核，判断其是否合规。

审核规则：
1. 内容不得包含涉黄、色情、性暗示等不良信息
2. 内容不得包含涉政、暴力、恐怖主义、仇恨言论等内容
3. 内容应该是个人独白、趣味文章、新闻报道等非对话类英文文本
4. 内容应该是适合语言学习的正常英语材料

请以 JSON 格式返回审核结果，格式如下：
{"safe": true, "reason": null}

如果不合规，格式如下：
{"safe": false, "reason": "具体不合规原因"}

只返回 JSON，不要返回任何其他内容。`

/**
 * 审核文本内容是否合规
 * @param text 待审核的文本
 * @returns 审核结果
 */
export async function moderateText(text: string): Promise<ModerationResult> {
  // 1. 读取配置
  const config = useRuntimeConfig()
  const ds = config.deepseek as unknown as DeepSeekConfig

  if (!ds?.apiKey || !ds?.baseUrl || !ds?.model) {
    logger.error('[contentModeration] DeepSeek 配置不完整')
    return { safe: false, reason: '内容审核服务配置缺失' }
  }

  // 2. 调用 DeepSeek API
  const url = `${ds.baseUrl.replace(/\/+$/, '')}/chat/completions`

  let callStart = 0
  try {
    // deepseek 云产品并发闸门：callStart 在队列 acquire 后才赋值，duration_ms 只计执行不计排队
    const resp = await withQueue('deepseek', () => {
      callStart = Date.now()
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
            { role: 'user', content: text },
          ],
          temperature: 0,
          max_tokens: 200,
        }),
        timeout: 15000,
        tag: '[contentModeration]',
      })
    })

    if (!resp.ok) {
      const body = await resp.text()
      logger.error(`[contentModeration] API 返回 ${resp.status}: ${body}`)
      void logCloudServiceCall({
        service: 'deepseek',
        operation: 'moderateText',
        success: false,
        durationMs: Date.now() - callStart,
        errorMessage: `HTTP ${resp.status}`,
      })
      return { safe: false, reason: '内容审核服务暂时不可用' }
    }

    const data = await resp.json()

    // 采集 DeepSeek Token 用量
    if (data?.usage) {
      fileLog('ai', 'info', '[contentModeration] Token 用量', {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      })
    }
    void logCloudServiceCall({
      service: 'deepseek',
      operation: 'moderateText',
      success: true,
      durationMs: Date.now() - callStart,
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
      totalTokens: data?.usage?.total_tokens ?? null,
    })

    const content: string = data?.choices?.[0]?.message?.content ?? ''

    // 3. 解析 JSON 响应
    const cleaned = content.replace(/```json?\n?/g, '').trim()
    const result = JSON.parse(cleaned)

    return {
      safe: !!result.safe,
      reason: result.safe ? null : result.reason || '内容不合规',
    }
  } catch (err) {
    void logCloudServiceCall({
      service: 'deepseek',
      operation: 'moderateText',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: String(err).substring(0, 500),
    })
    logger.error('[contentModeration] 审核调用失败:', err)
    return { safe: false, reason: '内容审核服务暂时不可用' }
  }
}
