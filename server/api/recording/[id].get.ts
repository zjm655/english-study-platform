import { query } from '#server/utils/db'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { Recording } from '#shared/types/recording'

/**
 * 获取单个录音详情
 * 请求：GET /api/recording/[id]
 */
export default defineEventHandler(async (event): Promise<ResPayload<Recording | null>> => {
  const userId: number = event.context.user.id
  const id = Number(getRouterParam(event, 'id'))

  if (!id || isNaN(id)) {
    return validateError('无效的录音ID')
  }

  // 联查 media 表获取音频
  const rows = await query<RecordingRow & { rec_media_key: string | null }>(
    `SELECT r.*, m.object_key AS rec_media_key
     FROM recording r
     LEFT JOIN media m ON r.media_id = m.id
     WHERE r.id = ? AND r.user_id = ? AND r.deleted_at IS NULL`,
    [id, userId]
  )

  const row = rows[0]
  if (!row) {
    return validateError('录音不存在', 404)
  }

  // 签名音频路径
  let signedPath: string | null = null
  if (row.rec_media_key) {
    signedPath = await signUrl(row.rec_media_key, RECORDING_EXPIRE)
  } else if (row.audioPath) {
    signedPath = row.audioPath.startsWith('https://')
      ? await signUrl(row.audioPath, RECORDING_EXPIRE)
      : row.audioPath
  }

  const recording = rowToRecording(row, signedPath)
  return validateSuccess(recording, '获取成功')
})