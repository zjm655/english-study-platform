import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'

/**
 * 检查单个单词是否已收藏
 * GET /api/user/fav-word/:vocabId/status
 */
export default defineEventHandler(async (event): Promise<ResPayload<{ isFav: boolean }>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const vocabId = Number(getRouterParam(event, 'vocabId'))
  if (!vocabId || isNaN(vocabId)) {
    return validateError('无效的单词ID')
  }

  const rows = await query(
    'SELECT id FROM user_fav_word WHERE user_id = ? AND vocabulary_id = ? AND deleted_at IS NULL',
    [userId, vocabId],
  )

  return validateSuccess({ isFav: rows.length > 0 }, '获取成功')
})
