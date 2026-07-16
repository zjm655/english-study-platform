import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'

/**
 * 获取当前用户收藏的片段 ID 列表
 * GET /api/user/fav-segments
 */
export default defineEventHandler(async (event): Promise<ResPayload<number[]>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const rows = await query<{ segment_id: number }>(
    'SELECT segment_id FROM user_fav_segment WHERE user_id = ? AND deleted_at IS NULL',
    [userId]
  )

  const ids = rows.map(r => r.segment_id)
  return validateSuccess(ids, '获取成功')
})