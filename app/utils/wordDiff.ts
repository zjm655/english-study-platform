/**
 * 词级对齐工具：将 ASR 识别文本与参考原文做 LCS 对齐，标记不一致的词。
 *
 * 用于 Phase3/Phase4 结果展示：把识别文本中「与原文不一致」的词标红。
 * segment 文本通常仅几句，O(n·m) 开销可忽略。
 */

export interface DiffToken {
  /** 原始（未归一化）显示文本 */
  word: string
  /** 是否与原文匹配（false 时标红） */
  match: boolean
}

/** 归一化：小写、去除首尾标点，仅用于比对，不影响展示 */
function normalize(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
}

/** 按空白切分为词 token（保留原始形态用于展示） */
function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

/**
 * 对识别文本与参考原文做词级 LCS 对齐。
 * @param recognizedText ASR 识别文本
 * @param referenceText  参考原文（segment.textContent）
 * @returns 识别文本的 token 列表，`match=false` 表示与原文不一致（应标红）
 */
export function diffRecognized(recognizedText: string, referenceText: string): DiffToken[] {
  const recTokens = tokenize(recognizedText)
  const refTokens = tokenize(referenceText)

  if (recTokens.length === 0) return []
  if (refTokens.length === 0) {
    return recTokens.map((word) => ({ word, match: false }))
  }

  const a = recTokens.map(normalize)
  const b = refTokens.map(normalize)
  const n = a.length
  const m = b.length

  // LCS 动态规划
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] && a[i] !== ''
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  // 回溯：标记 recognized token 是否命中 LCS
  const result: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < n) {
    if (j < m && a[i] === b[j] && a[i] !== '') {
      result.push({ word: recTokens[i]!, match: true })
      i++
      j++
    } else if (j < m && dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      // recognized[i] 未匹配
      result.push({ word: recTokens[i]!, match: false })
      i++
    } else if (j < m) {
      // reference[j] 被跳过，前进 reference 指针
      j++
    } else {
      // reference 已耗尽，剩余 recognized 全部视为不一致
      result.push({ word: recTokens[i]!, match: false })
      i++
    }
  }

  return result
}
