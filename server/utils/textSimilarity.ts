/**
 * 文本相似度对比工具
 *
 * 使用词级 Jaccard 相似度比较两段文本。
 * 纯函数，零依赖。
 */

export interface SimilarityResult {
  /** 0~1 之间的相似度分数 */
  score: number
  /** 是否达到阈值 */
  passed: boolean
}

/** 将文本标准化为词集合：小写、去除标点、按空白分词 */
function tokenize(text: string): Set<string> {
  if (!text.trim()) return new Set()
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
  return new Set(normalized)
}

/**
 * 比较两段文本的词级 Jaccard 相似度
 * @param original 原始文本
 * @param recognized 识别/对比文本
 * @param threshold 通过阈值，默认 0.4
 */
export function compareTextSimilarity(
  original: string,
  recognized: string,
  threshold: number = 0.4
): SimilarityResult {
  const setA = tokenize(original)
  const setB = tokenize(recognized)

  if (setA.size === 0 || setB.size === 0) {
    return { score: 0, passed: false }
  }

  let intersection = 0
  for (const word of setA) {
    if (setB.has(word)) intersection++
  }

  const union = setA.size + setB.size - intersection
  const score = union === 0 ? 0 : intersection / union

  return { score, passed: score >= threshold }
}