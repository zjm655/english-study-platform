import { query, withTransaction } from '#server/utils/db'
import type { UserProgressRow } from '#server/types/db'
import type { ResultSetHeader } from 'mysql2'

/**
 * 更新用户学习进度
 * PUT /api/user/progress
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  if (!userId) {
    return validateError('未登录', 401)
  }

  const body = await readBody(event)
  const { segmentId, phase, done, score } = body

  // 参数校验
  if (!segmentId || !phase || typeof done !== 'boolean') {
    return validateError('参数错误：需要 segmentId, phase, done')
  }
  if (phase < 1 || phase > 4) {
    return validateError('phase 必须是 1-4')
  }
  if ((phase === 3 || phase === 4) && done && score === undefined) {
    return validateError(`phase ${phase} 完成时需要提供 score`)
  }

  const result = await withTransaction(async (conn) => {
    // 查现有记录
    const existing = await query<UserProgressRow>(
      'SELECT * FROM user_progress WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL',
      [userId, segmentId]
    )

    if (existing.length === 0) {
      // 不存在 → INSERT
      const fields = ['user_id', 'segment_id', `phase${phase}_done`]
      const values: any[] = [userId, segmentId, done ? 1 : 0]

      if ((phase === 3 || phase === 4) && score !== undefined) {
        fields.push(`phase${phase}_score`)
        values.push(score)
      }

      await conn.execute<ResultSetHeader>(
        `INSERT INTO user_progress (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        values
      )
    } else {
      // 存在 → UPDATE
      const updates = [`phase${phase}_done = ?`]
      const values: any[] = [done ? 1 : 0]

      if ((phase === 3 || phase === 4) && score !== undefined) {
        // 只更新更高的分数
        updates.push(`phase${phase}_score = GREATEST(COALESCE(phase${phase}_score, 0), ?)`)
        values.push(score)
      }

      values.push(userId, segmentId)

      await conn.execute(
        `UPDATE user_progress SET ${updates.join(', ')} WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL`,
        values
      )
    }

    // 返回更新后的进度
    const updated = await query<UserProgressRow>(
      'SELECT * FROM user_progress WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL',
      [userId, segmentId]
    )

    return updated[0]
  })

  return validateSuccess({
    segmentId: result.segment_id,
    phase1_done: !!result.phase1_done,
    phase2_done: !!result.phase2_done,
    phase3_done: !!result.phase3_done,
    phase3_score: result.phase3_score ? Number(result.phase3_score) : null,
    phase4_done: !!result.phase4_done,
    phase4_score: result.phase4_score ? Number(result.phase4_score) : null,
    updatedAt: result.updatedAt
  }, '更新进度成功', 200)
})
