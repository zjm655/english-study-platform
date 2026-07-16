import { query } from '#server/utils/db'
import { validateError, validateSuccess, favWordSchema } from '#server/utils/validate'

/**
 * 收藏/取消收藏单词（toggle）
 * POST /api/user/fav-word
 * body: { vocabularyId: number }
 */
export default defineEventHandler(async (event): Promise<ResPayload<{ isFav: boolean }>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const body = await readBody(event)
  const parsed = favWordSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message || '参数校验失败')
  }
  const { vocabularyId } = parsed.data

  // 检查 vocabulary 是否存在
  const vocabRows = await query('SELECT id FROM vocabulary WHERE id = ?', [vocabularyId])
  if (vocabRows.length === 0) {
    return validateError('单词不存在', 404)
  }

  // 查询现有收藏记录
  const existing = await query<{ id: number; deleted_at: string | null }>(
    'SELECT id, deleted_at FROM user_fav_word WHERE user_id = ? AND vocabulary_id = ?',
    [userId, vocabularyId]
  )

  let isFav: boolean

  if (existing.length === 0) {
    // 没有记录 → 插入新收藏
    await query(
      'INSERT INTO user_fav_word (user_id, vocabulary_id) VALUES (?, ?)',
      [userId, vocabularyId]
    )
    isFav = true
  } else {
    const record = existing[0]
    if (!record) return validateError('数据异常', 500)
    if (record.deleted_at === null) {
      // 已收藏 → 软删除（取消收藏）
      await query(
        'UPDATE user_fav_word SET deleted_at = NOW() WHERE id = ?',
        [record.id]
      )
      isFav = false
    } else {
      // 曾经收藏过，已软删除 → 恢复
      await query(
        'UPDATE user_fav_word SET deleted_at = NULL WHERE id = ?',
        [record.id]
      )
      isFav = true
    }
  }

  return validateSuccess({ isFav }, isFav ? '收藏成功' : '已取消收藏')
})