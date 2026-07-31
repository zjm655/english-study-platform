import { withTransaction } from '#server/utils/db'
import { validateError, validateSuccess, favWordSchema } from '#server/utils/validate'
import { resolveAndEnsureGuestUserId } from '#server/utils/guestEnsure'
import type { RowDataPacket } from 'mysql2'

type IdRow = RowDataPacket & { id: number }
type FavRow = RowDataPacket & { id: number; deleted_at: string | null }

/**
 * 收藏/取消收藏单词（toggle，登录用户 + 游客）
 * POST /api/user/fav-word
 * body: { vocabularyId: number }
 */
export default defineEventHandler(async (event): Promise<ResPayload<{ isFav: boolean }>> => {
  const userId = event.context.user?.id ?? await resolveAndEnsureGuestUserId(event)
  if (!userId) return validateError('未登录', 401)

  const body = await readBody(event)
  const parsed = favWordSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message || '参数校验失败')
  }
  const { vocabularyId } = parsed.data

  try {
    const isFav = await withTransaction(async (conn) => {
      // 检查 vocabulary 是否存在
      const [vocabRows] = await conn.execute<IdRow[]>(
        'SELECT id FROM vocabulary WHERE id = ? LIMIT 1',
        [vocabularyId],
      )
      if (vocabRows.length === 0) {
        throw new Error('NOT_FOUND:单词不存在')
      }

      // 查询现有收藏记录
      const [existing] = await conn.execute<FavRow[]>(
        'SELECT id, deleted_at FROM user_fav_word WHERE user_id = ? AND vocabulary_id = ? LIMIT 1',
        [userId, vocabularyId],
      )

      if (existing.length === 0) {
        // 没有记录 → 插入新收藏
        await conn.execute('INSERT INTO user_fav_word (user_id, vocabulary_id) VALUES (?, ?)', [
          userId,
          vocabularyId,
        ])
        return true
      }

      const record = existing[0]
      if (!record) throw new Error('DATA_ERROR')

      if (record.deleted_at === null) {
        // 已收藏 → 软删除（取消收藏）
        await conn.execute('UPDATE user_fav_word SET deleted_at = NOW() WHERE id = ?', [record.id])
        return false
      }

      // 曾经收藏过，已软删除 → 恢复
      await conn.execute('UPDATE user_fav_word SET deleted_at = NULL WHERE id = ?', [record.id])
      return true
    })

    return validateSuccess({ isFav }, isFav ? '收藏成功' : '已取消收藏')
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.startsWith('NOT_FOUND:')) return validateError(msg.slice(10), 404)
    logger.error('[fav-word]', err)
    return validateError('操作失败，请重试')
  }
})
