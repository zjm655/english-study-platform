import { query } from '#server/utils/db'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { Recording } from '#shared/types/recording'

/**
 * 查询录音列表
 * 请求：GET /api/recording?segmentId=1&phase=3
 */
export default defineEventHandler(async (event): Promise<ResPayload<Recording[]>> => {
  const userId: number = event.context.user.id
  const queryParams = getQuery(event)
  const segmentId = Number(queryParams.segmentId)
  const phase = Number(queryParams.phase)

  // 联查 media 表获取音频
  const rows = await query<RecordingRow & { rec_media_key: string | null }>(
    `SELECT r.*, m.object_key AS rec_media_key
     FROM recording r
     LEFT JOIN media m ON r.media_id = m.id
     WHERE r.user_id = ? AND r.segment_id = ? AND r.phase = ? AND r.deleted_at IS NULL
     ORDER BY r.createdAt DESC`,
    [userId, segmentId, phase]
  )

  // 签名音频路径
  const recordings: Recording[] = await Promise.all(
    rows.map(async (row) => {
      let signedPath: string | null = null
      if (row.rec_media_key) {
        signedPath = await signUrl(row.rec_media_key, RECORDING_EXPIRE)
      } else if (row.audioPath) {
        signedPath = row.audioPath.startsWith('https://')
          ? await signUrl(row.audioPath, RECORDING_EXPIRE)
          : row.audioPath
      }
      return rowToRecording(row, signedPath)
    })
  )

  return validateSuccess(recordings, '获取成功')
})