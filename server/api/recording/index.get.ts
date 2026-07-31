import { query } from '#server/utils/db'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { rowToRecording } from '#server/utils/recording'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'
import type { RecordingRow, CountRow } from '#server/types/db'
import type { Recording, PaginatedRecordings } from '#shared/types/recording'

/**
 * 查询录音列表（登录用户 + 游客）
 * 请求：GET /api/recording?segmentId=1&phase=3&page=1&pageSize=3
 * 兼容：过渡期仍接受旧参数名 size（前后端统一为 pageSize 后可移除该回退）。
 */
export default defineEventHandler(async (event): Promise<ResPayload<PaginatedRecordings>> => {
  // 身份解析：登录用户走 context，游客优先 guest_token 再指纹兜底
  let userId: number | null = event.context.user?.id ?? null
  if (!userId) {
    userId = await resolveEffectiveUserId(event)
  }
  if (!userId) {
    const fingerprint = getRequestHeader(event, 'x-guest-fingerprint')
    if (fingerprint && /^[a-f0-9]{64}$/.test(fingerprint)) {
      const rows = await query<{ id: number }>(
        'SELECT id FROM user WHERE fingerprint_hash = ? AND is_guest = 1 AND merged_into_user_id IS NULL LIMIT 1',
        [fingerprint],
      )
      if (rows.length > 0) userId = rows[0]!.id
    }
  }
  if (!userId)
    return validateSuccess<PaginatedRecordings>(
      { items: [], total: 0, page: 1, pageSize: 3 },
      '获取成功',
    )
  const queryParams = getQuery(event)
  const segmentId = Number(queryParams.segmentId)
  const phase = Number(queryParams.phase)
  const page = Math.max(1, Number(queryParams.page) || 1)
  const pageSize = Math.max(1, Math.min(50, Number(queryParams.pageSize ?? queryParams.size) || 3))
  const offset = (page - 1) * pageSize

  // 查总数
  const countRows = await query<CountRow>(
    `SELECT COUNT(*) as total FROM recording r
     WHERE r.user_id = ? AND r.segment_id = ? AND r.phase = ? AND r.deleted_at IS NULL`,
    [userId, segmentId, phase],
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
    [userId, segmentId, phase, pageSize, offset],
  )

  // 签名音频路径
  const results = await Promise.all(
    rows.map(async (row) => {
      const signedPath = row.rec_media_key
        ? await signUrl(row.rec_media_key, RECORDING_EXPIRE)
        : null
      return rowToRecording(row, signedPath)
    }),
  )
  const items = results.filter((r): r is Recording => r !== null)

  return validateSuccess<PaginatedRecordings>({ items, total, page, pageSize }, '获取成功')
})
