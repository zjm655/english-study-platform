import { query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import { parseSdkResult } from '#server/utils/evaluationResult'
import type { RecordingRow, SegmentRow } from '#server/types/db'
import type { RowDataPacket } from 'mysql2'
import type { Recording, WordScore } from '#shared/types/recording'

/**
 * 保存录音 AI 分析结果
 * 请求：POST /api/recording/[id]/analyze
 * Body: { sdkResult: object } — SDK 评测返回的完整结果 JSON
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

  // 2. 读取 SDK 结果
  const body = await readBody<{ sdkResult?: Record<string, unknown> }>(event)
  const sdkResult = body?.sdkResult

  if (!sdkResult || typeof sdkResult !== 'object') {
    return validateError('缺少 SDK 评测结果数据', 400)
  }

  // 3. 解析 SDK 结果
  const parsed = parseSdkResult(sdkResult)

  // 4. 更新 recording 表
  let updatedRecording: ReturnType<typeof rowToRecording> = null
  try {
    updatedRecording = await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE recording
         SET score = ?, feedback = ?, recognizedText = ?, wordScores = ?
         WHERE id = ?`,
        [parsed.score, parsed.feedback, parsed.recognizedText, JSON.stringify(parsed.wordScores), id]
      )

      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
        [id]
      )
      return rowToRecording(rows[0] as RecordingRow)
    })
  } catch (err) {
    logger.error('[recording analyze] 事务失败:', err)
    return validateError('分析保存失败，请稍后重试', 500)
  }

  if (!updatedRecording) {
    return validateError('分析保存失败', 500)
  }

  return validateSuccess(updatedRecording, '分析完成')
})
