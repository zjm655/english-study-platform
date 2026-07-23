/**
 * 评测结果处理工具
 * 前端 SDK 已将原始 JSON 解析为 EvaluationResult，后端只需补充 feedback 后入库
 */

export interface ParsedEvalResult {
  score: number
  feedback: string
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
 * 处理评测结果：补全 status 和 feedback
 * @param input 前端传来的已解析评测结果（{ score, wordScores }）
 */
export function processEvaluationResult(input: {
  score: number
  wordScores: { word: string; score: number }[]
}): ParsedEvalResult {
  const wordScores: ParsedEvalResult['wordScores'] = input.wordScores.map((w) => ({
    word: w.word,
    score: w.score,
    status: scoreToStatus(w.score),
  }))

  const feedback = generateFeedback(input.score)

  return {
    score: input.score,
    feedback,
    wordScores,
  }
}

/** 根据总分生成中文反馈建议 */
function generateFeedback(overall: number): string {
  if (overall >= 85) {
    return '整体表现优秀，发音清晰准确，继续保持！'
  } else if (overall >= 70) {
    return '整体表现良好，发音基本准确，可以进一步优化语调。'
  } else if (overall >= 50) {
    return '整体表现一般，部分发音需要加强，建议多听多练。'
  } else if (overall > 0) {
    return '请多练习，注意每个单词的标准发音，建议跟读模仿。'
  }
  return ''
}
