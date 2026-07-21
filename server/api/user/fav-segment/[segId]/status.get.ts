import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'

/**
 * 检查单个片段是否已收藏
 * GET /api/user/fav-segment/:segId/status
 */
export default defineEventHandler(async (event): Promise<ResPayload<{ isFav: boolean }>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const segId = Number(getRouterParam(event, 'segId'))
  if (!segId || isNaN(segId)) {
    return validateError('无效的片段ID')
  }

  const rows = await query(
    'SELECT id FROM user_fav_segment WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL',
    [userId, segId],
  )

  return validateSuccess({ isFav: rows.length > 0 }, '获取成功')
})
