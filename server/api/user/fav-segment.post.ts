import { query } from '#server/utils/db'
import { validateError, validateSuccess, favSegmentSchema } from '#server/utils/validate'

/**
 * 收藏/取消收藏片段（toggle）
 * POST /api/user/fav-segment
 * body: { segmentId: number }
 */
export default defineEventHandler(async (event): Promise<ResPayload<{ isFav: boolean }>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const body = await readBody(event)
  const parsed = favSegmentSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message || '参数校验失败')
  }
  const { segmentId } = parsed.data

  // 检查 segment 是否存在
  const segRows = await query('SELECT id FROM segment WHERE id = ?', [segmentId])
  if (segRows.length === 0) {
    return validateError('片段不存在', 404)
  }

  // 查询现有收藏记录
  const existing = await query<{ id: number; deleted_at: string | null }>(
    'SELECT id, deleted_at FROM user_fav_segment WHERE user_id = ? AND segment_id = ?',
    [userId, segmentId]
  )

  let isFav: boolean

  if (existing.length === 0) {
    // 没有记录 → 插入新收藏
    await query(
      'INSERT INTO user_fav_segment (user_id, segment_id) VALUES (?, ?)',
      [userId, segmentId]
    )
    isFav = true
  } else {
    const record = existing[0]
    if (record.deleted_at === null) {
      // 已收藏 → 软删除（取消收藏）
      await query(
        'UPDATE user_fav_segment SET deleted_at = NOW() WHERE id = ?',
        [record.id]
      )
      isFav = false
    } else {
      // 曾经收藏过，已软删除 → 恢复
      await query(
        'UPDATE user_fav_segment SET deleted_at = NULL WHERE id = ?',
        [record.id]
      )
      isFav = true
    }
  }

  return validateSuccess({ isFav }, isFav ? '收藏成功' : '已取消收藏')
})