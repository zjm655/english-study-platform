/**
 * 解析 txt 文件内容（不再承担标题解析——标题由上传的 titleMode 决定）。
 * 约定：仅校验非空并清理空白；首行即使形如标题也作为正文保留，
 *       内联标题提取走 extractInlineTitle。
 */
export function parseTxtFile(content: string): { textContent: string } {
  if (!content.trim()) {
    throw new Error('TXT 文件内容为空')
  }
  return { textContent: content.trim() }
}

/** 内联标题行匹配模式：第一个非空行以 `# ` 开头（如 `# A Day at the Park`） */
const INLINE_TITLE_RE = /^#\s+(.+)$/

/**
 * 提取内联标题：正文第一个非空行以 `# ` 开头时作为标题并从正文移除；
 * 未命中时 title=null、正文原样返回。供 titleMode=inline 的同步段使用。
 */
export function extractInlineTitle(text: string): { title: string | null; textContent: string } {
  const trimmed = text.trim()
  if (!trimmed) return { title: null, textContent: '' }

  const lines = trimmed.split('\n')
  // 定位第一个非空行（容错前导空行）
  let firstNonEmpty = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim()) {
      firstNonEmpty = i
      break
    }
  }
  if (firstNonEmpty === -1) return { title: null, textContent: trimmed }

  const match = INLINE_TITLE_RE.exec(lines[firstNonEmpty]!.trim())
  if (!match?.[1]) return { title: null, textContent: trimmed }

  const title = match[1].trim()
  const rest = lines
    .slice(firstNonEmpty + 1)
    .join('\n')
    .trim()
  return { title, textContent: rest }
}

/** 标题最大长度（AI 生成失败 / 文件名超长时截取；title 列 varchar(100) 内安全） */
export const MAX_TITLE_LENGTH = 50

/** 按 titleMode 解析同步段标题的结果 */
export interface TitleResolution {
  /** 已确定的标题；null=需交流水线 AI 生成 */
  title: string | null
  /** 处理后的正文（inline 模式已移除标题行） */
  textContent: string
  /** 同步段提示（如文件名超长截取），供入队回执展示 */
  notice?: string
}

export interface ResolveUploadTitleOptions {
  titleMode: 'ai' | 'manual' | 'text_filename' | 'audio_filename' | 'inline'
  title?: string | null
  fileName?: string | null
  textContent: string
}

/**
 * 按标题生成方式解析同步段标题：
 * - ai：title=null，交流水线 AI 生成 + 失败截取
 * - manual：直接用用户填写的 title
 * - text_filename / audio_filename：用对应文件名（去扩展名）作标题，超过 MAX_TITLE_LENGTH 截取并返回 notice
 * - inline：正文第一个非空行以 `# ` 开头时提取为标题并从正文移除
 */
export function resolveUploadTitle(opts: ResolveUploadTitleOptions): TitleResolution {
  switch (opts.titleMode) {
    case 'inline':
      return extractInlineTitle(opts.textContent)
    case 'text_filename':
    case 'audio_filename': {
      // 两种模式逻辑一致：用 opts.fileName（调用方已按模式传入对应文件名）去扩展名，超 MAX_TITLE_LENGTH 截取 + notice
      const raw = (opts.fileName ?? '').replace(/\.[^.]+$/, '').trim()
      if (!raw) return { title: null, textContent: opts.textContent }
      if (raw.length > MAX_TITLE_LENGTH) {
        return {
          title: raw.slice(0, MAX_TITLE_LENGTH),
          textContent: opts.textContent,
          notice: `标题超过 ${MAX_TITLE_LENGTH} 字符，已截取`,
        }
      }
      return { title: raw, textContent: opts.textContent }
    }
    case 'manual': {
      const t = opts.title?.trim() || null
      return { title: t, textContent: opts.textContent }
    }
    default:
      // ai
      return { title: null, textContent: opts.textContent }
  }
}

// 对话行匹配模式：行首为 Name + 冒号
// 匹配：Alice: / Speaker 1: / Interviewer:
// 不匹配："I can't believe this," / The sun rose / Alice said:
const DIALOGUE_LINE_RE = /^[A-Z][a-z]*(?:\s+\d+)?\s*:/

/**
 * 正则启发式对话检测。
 * 规则：>30% 非空行匹配对话行模式，则判定为对话。
 */
export function isDialogueText(text: string): boolean {
  if (!text.trim()) return false

  const lines = text.split('\n')
  const nonEmptyLines = lines.filter((l) => l.trim())
  if (nonEmptyLines.length === 0) return false

  let matchCount = 0
  for (const line of nonEmptyLines) {
    if (DIALOGUE_LINE_RE.test(line.trim())) {
      matchCount++
    }
  }

  return matchCount / nonEmptyLines.length > 0.3
}
