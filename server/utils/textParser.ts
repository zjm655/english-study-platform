/**
 * 解析 txt 文件内容：首行=标题，其余=正文。
 * 约定：文字首行非空为标题；首行为空或仅一行则 title 为 null。
 * 空内容或仅空白字符抛错。
 */
export function parseTxtFile(content: string): { title: string | null, textContent: string } {
  if (!content.trim()) {
    throw new Error('TXT 文件内容为空')
  }

  const lines = content.split('\n')

  // 文字首行为空 → 无标题
  if (!lines[0]!.trim()) {
    return { title: null, textContent: content.trim() }
  }

  // 仅一行 → 无标题
  if (lines.length <= 1) {
    return { title: null, textContent: lines[0]!.trim() }
  }

  // 首行非空且有后续内容 → 首行为标题
  const title = lines[0]!.trim()
  const textContent = lines.slice(1).join('\n').trim()

  return { title, textContent }
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
  const nonEmptyLines = lines.filter(l => l.trim())
  if (nonEmptyLines.length === 0) return false

  let matchCount = 0
  for (const line of nonEmptyLines) {
    if (DIALOGUE_LINE_RE.test(line.trim())) {
      matchCount++
    }
  }

  return matchCount / nonEmptyLines.length > 0.3
}