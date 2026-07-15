import { query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow, SegmentRow } from '#server/types/db'
import type { Recording, WordScore } from '#shared/types/recording'

/**
 * 发起录音 AI 分析（当前返回模拟数据）
 * 请求：POST /api/recording/[id]/analyze
 */
export default defineEventHandler(async (event): Promise<ResPayload<Recording | null>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const id = Number(getRouterParam(event, 'id'))

  if (!id || isNaN(id)) {
    return validateError('无效的录音ID')
  }

  // 1. 查录音记录，验证归属
  const recordings = await query<RecordingRow>(
    'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
    [id]
  )
  const recording = recordings[0]

  if (!recording) {
    return validateError('录音不存在', 404)
  }

  if (recording.user_id !== userId) {
    return validateError('无权限访问该录音', 403)
  }

  // 2. 查片段的原文（用于模拟识别结果和逐词评分）
  const segments = await query<SegmentRow>(
    'SELECT textContent FROM segment WHERE id = ?',
    [recording.segment_id]
  )
  const textContent = segments[0]?.textContent || ''

  // 3. 生成模拟分析数据
  const { score, feedback, recognizedText, wordScores } = generateMockAnalysis(textContent)

  // 4. 更新 recording 表（使用事务保证一致性）
  let updatedRecording: ReturnType<typeof rowToRecording> = null
  try {
    updatedRecording = await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE recording
         SET score = ?, feedback = ?, recognizedText = ?, wordScores = ?
         WHERE id = ?`,
        [score, feedback, recognizedText, JSON.stringify(wordScores), id]
      )

      // 返回更新后的记录（事务内查询，使用 conn.execute 确保连接一致性）
      const [rows] = await conn.execute<RecordingRow[]>(
        'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
        [id]
      )
      return rowToRecording(rows[0])
    })
  } catch (err) {
    console.error('[recording analyze] 事务失败:', err)
    return validateError('分析保存失败，请稍后重试', 500)
  }

  if (!updatedRecording) {
    return validateError('分析保存失败', 500)
  }

  return validateSuccess(updatedRecording, '分析完成')
})

/** 生成模拟分析数据 */
function generateMockAnalysis(textContent: string) {
  // 综合评分：75-95 随机
  const overallScore = Math.floor(Math.random() * 21) + 75

  // 分词生成逐词评分
  const words = textContent.split(/\s+|[.,!?;:"]/).filter(w => /[a-zA-Z]/.test(w))
  const wordScores: WordScore[] = words.map(word => {
    const score = Math.floor(Math.random() * 31) + 70 // 70-100
    let status: 'correct' | 'minor' | 'wrong'
    if (score >= 90) status = 'correct'
    else if (score >= 75) status = 'minor'
    else status = 'wrong'
    return { word, score, status }
  })

  // 反馈文案模板
  const feedbackTemplates = [
    '整体发音清晰，语调自然。建议注意元音的饱满度，特别是长元音的发音时长。',
    '朗读流畅，节奏感不错。部分辅音结尾可以更清晰，注意词尾不要吞音。',
    '语音语调表现良好，重音位置基本准确。建议多练习连读和弱读，让语速更自然。',
    '发音准确度较高，大部分单词发音正确。可以加强语调起伏，避免平铺直叙。',
  ]
  const feedback = feedbackTemplates[Math.floor(Math.random() * feedbackTemplates.length)]

  return {
    score: overallScore,
    feedback,
    recognizedText: textContent,
    wordScores,
  }
}
