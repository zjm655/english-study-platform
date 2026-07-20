import { query } from '#server/utils/db'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow, CountRow } from '#server/types/db'
import type { Recording, PaginatedRecordings } from '#shared/types/recording'

/**
 * 查询录音列表
 * 请求：GET /api/recording?segmentId=1&phase=3&page=1&size=3
 */
export default defineEventHandler(async (event): Promise<ResPayload<PaginatedRecordings>> => {
  const userId: number = event.context.user.id
  const queryParams = getQuery(event)
  const segmentId = Number(queryParams.segmentId)
  const phase = Number(queryParams.phase)
  const page = Math.max(1, Number(queryParams.page) || 1)
  const size = Math.max(1, Math.min(50, Number(queryParams.size) || 3))
  const offset = (page - 1) * size

  // 查总数
  const countRows = await query<CountRow>(
    `SELECT COUNT(*) as total FROM recording r
     WHERE r.user_id = ? AND r.segment_id = ? AND r.phase = ? AND r.deleted_at IS NULL`,
    [userId, segmentId, phase]
  )
  const total = countRows[0]?.total ?? 0

  // 查分页数据
  const rows = await query<RecordingRow & { rec_media_key: string | null }>(
    `SELECT r.*, m.object_key AS rec_media_key
     FROM recording r
     LEFT JOIN media m ON r.media_id = m.id
     WHERE r.user_id = ? AND r.segment_id = ? AND r.phase = ? AND r.deleted_at IS NULL
     ORDER BY r.createdAt DESC
     LIMIT ? OFFSET ?`,
    [userId, segmentId, phase, size, offset]
  )

  // 签名音频路径
  const results = await Promise.all(
    rows.map(async (row) => {
      const signedPath = row.rec_media_key
        ? await signUrl(row.rec_media_key, RECORDING_EXPIRE)
        : null
      return rowToRecording(row, signedPath)
    })
  )
  const items = results.filter((r): r is Recording => r !== null)

  return validateSuccess<PaginatedRecordings>({ items, total, page, size }, '获取成功')
})