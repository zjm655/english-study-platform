import { query } from '#server/utils/db'
import { validateSuccess } from '#server/utils/validate'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'

/**
 * 获取当前用户收藏的单词 ID 列表（登录用户 + 游客）
 * GET /api/user/fav-words
 */
export default defineEventHandler(async (event): Promise<ResPayload<number[]>> => {
  const userId = await resolveEffectiveUserId(event)
  if (!userId) return validateSuccess([], '获取成功')

  const rows = await query<{ vocabulary_id: number }>(
    'SELECT vocabulary_id FROM user_fav_word WHERE user_id = ? AND deleted_at IS NULL',
    [userId],
  )

  const ids = rows.map((r) => r.vocabulary_id)
  return validateSuccess(ids, '获取成功')
})
