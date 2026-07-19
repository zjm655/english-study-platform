/**
 * SDK 评测结果解析工具
 * 将 en.pred.score 返回的 JSON 解析为 recording 表入库数据
 */

export interface ParsedEvalResult {
  score: number
  feedback: string
  recognizedText: string
  wordScores: { word: string; score: number; status: 'correct' | 'minor' | 'wrong' | 'missing' }[]
}

/** 分数 → 状态映射 */
function scoreToStatus(score: number): ParsedEvalResult['wordScores'][number]['status'] {
  if (score >= 80) return 'correct'
  if (score >= 60) return 'minor'
  if (score >= 40) return 'wrong'
  return 'missing'
}

/**
 * 解析 SDK 评测结果
 * @param sdkResult SDK 返回的完整 result 对象（包含 result.overall, result.details 等）
 */
export function parseSdkResult(sdkResult: Record<string, unknown>): ParsedEvalResult {
  const result = (sdkResult.result ?? sdkResult) as Record<string, unknown>
  const overall = Number(result.overall ?? 0)
  const details = (result.details ?? []) as Record<string, unknown>[]

  const wordScores: ParsedEvalResult['wordScores'] = []
  const recognizedParts: string[] = []

  for (const detail of details) {
    const sntDetails = (detail.snt_details ?? []) as Record<string, unknown>[]
    for (const w of sntDetails) {
      const word = String(w.char ?? w.word ?? '')
      const score = Number(w.score ?? 0)
      // 过滤空白词（dp_type=1 漏读的词也可能有 char，保留但标记）
      if (!word.trim()) continue
      wordScores.push({ word, score, status: scoreToStatus(score) })
      recognizedParts.push(word)
    }
  }

  const pron = Number(result.pron ?? result.accuracy ?? 0)
  const fluency = Number(result.fluency ?? 0)
  const integrity = Number(result.integrity ?? 0)

  let feedback = ''
  if (overall > 0) {
    feedback = generateFeedback(overall, pron, fluency, integrity)
  }

  return {
    score: overall,
    feedback,
    recognizedText: recognizedParts.join(' '),
    wordScores,
  }
}

/** 根据各维度得分生成中文反馈建议 */
function generateFeedback(
  overall: number,
  pron: number,
  fluency: number,
  integrity: number,
): string {
  const parts: string[] = []

  if (overall >= 85) {
    parts.push('整体表现优秀，发音清晰准确。')
  } else if (overall >= 70) {
    parts.push('整体表现良好，发音基本准确。')
  } else if (overall >= 50) {
    parts.push('整体表现一般，部分发音需要加强。')
  } else {
    parts.push('请多练习，注意每个单词的标准发音。')
  }

  if (pron < 60) {
    parts.push('建议重点练习元音的饱满度和辅音的清晰度。')
  } else if (pron < 80) {
    parts.push('可以进一步优化个别单词的发音。')
  }

  if (fluency > 0 && fluency < 60) {
    parts.push('注意朗读的流畅性，适当减少停顿。')
  }

  if (integrity > 0 && integrity < 60) {
    parts.push('注意读完整段内容，不要漏词。')
  }

  return parts.join('')
}
