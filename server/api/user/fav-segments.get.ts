import { query } from '#server/utils/db'
import { validateSuccess } from '#server/utils/validate'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'

/**
 * 获取当前用户收藏的片段 ID 列表（登录用户 + 游客）
 * GET /api/user/fav-segments
 */
export default defineEventHandler(async (event): Promise<ResPayload<number[]>> => {
  const userId = await resolveEffectiveUserId(event)
  if (!userId) return validateSuccess([], '获取成功')

  const rows = await query<{ segment_id: number }>(
    'SELECT segment_id FROM user_fav_segment WHERE user_id = ? AND deleted_at IS NULL',
    [userId],
  )

  const ids = rows.map((r) => r.segment_id)
  return validateSuccess(ids, '获取成功')
})
