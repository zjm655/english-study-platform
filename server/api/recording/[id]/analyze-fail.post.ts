import { query, withTransaction } from '#server/utils/db'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { RowDataPacket } from 'mysql2'
import type { Recording } from '#shared/types/recording'

/**
 * 标记录音分析失败
 * 请求：POST /api/recording/[id]/analyze-fail
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
    [id],
  )
  const recording = recordings[0]

  if (!recording) {
    return validateError('录音不存在', 404)
  }

  if (recording.user_id !== userId) {
    return validateError('无权限访问该录音', 403)
  }

  logger.info(`[recording analyze-fail] 标记分析失败 id=${id}`)

  // 2. 更新 analyze_status='failed'，并查回签名后的记录
  let updatedRecording: ReturnType<typeof rowToRecording>
  try {
    updatedRecording = await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE recording SET analyze_status = 'failed' WHERE id = ? AND user_id = ?`,
        [id, userId],
      )

      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT r.*, m.object_key AS rec_media_key
         FROM recording r
         LEFT JOIN media m ON r.media_id = m.id
         WHERE r.id = ? AND r.deleted_at IS NULL`,
        [id],
      )
      const row = rows[0] as (RecordingRow & { rec_media_key: string | null }) | undefined

      const signedPath = row?.rec_media_key
        ? await signUrl(row.rec_media_key, RECORDING_EXPIRE)
        : null
      return rowToRecording(row, signedPath)
    })
  } catch (err) {
    logger.error('[recording analyze-fail] 事务失败:', err)
    return validateError('标记失败，请稍后重试', 500)
  }

  if (!updatedRecording) {
    return validateError('标记失败', 500)
  }

  logger.info(`[recording analyze-fail] 已标记为分析失败 id=${id}`)
  return validateSuccess(updatedRecording, '已标记为分析失败')
})
