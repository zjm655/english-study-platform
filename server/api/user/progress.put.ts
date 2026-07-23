import { withTransaction } from '#server/utils/db'
import { validateError, validateSuccess, progressSchema } from '#server/utils/validate'
import type { UserProgressRow } from '#server/types/db'
import type { ResultSetHeader } from 'mysql2'
import type { ZodSafeParseResult } from 'zod'
import { mapProgressRow } from '#shared/utils/progress'

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

  // zod 校验
  const parseResult: ZodSafeParseResult<{
    segmentId: number
    phase: number
    done: boolean
    score?: number
  }> = progressSchema.safeParse(body)
  if (!parseResult.success) {
    const errorMessage = parseResult.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage)
  }

  const { segmentId, phase, done, score } = parseResult.data

  const result = await withTransaction(async (conn) => {
    // 查现有记录（事务内必须用 conn.execute，否则读不到未提交数据）
    const [existingRows] = await conn.execute(
      'SELECT * FROM user_progress WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL',
      [userId, segmentId],
    )
    const existing = existingRows as UserProgressRow[]

    if (existing.length === 0) {
      // 不存在 → INSERT
      const fields = ['user_id', 'segment_id', `phase${phase}_done`]
      const values: (number | string)[] = [userId, segmentId, done ? 1 : 0]

      if ((phase === 3 || phase === 4) && score !== undefined) {
        fields.push(`phase${phase}_score`)
        values.push(score)
      }

      await conn.execute<ResultSetHeader>(
        `INSERT INTO user_progress (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
        values,
      )
    } else {
      // 存在 → UPDATE
      const updates = [`phase${phase}_done = ?`]
      const values: (number | string)[] = [done ? 1 : 0]

      if ((phase === 3 || phase === 4) && score !== undefined) {
        // 只更新更高的分数
        updates.push(`phase${phase}_score = GREATEST(COALESCE(phase${phase}_score, 0), ?)`)
        values.push(score)
      }

      values.push(userId, segmentId)

      await conn.execute(
        `UPDATE user_progress SET ${updates.join(', ')} WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL`,
        values,
      )
    }

    // 返回更新后的进度（事务内必须用 conn.execute）
    const [updatedRows] = await conn.execute(
      'SELECT * FROM user_progress WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL',
      [userId, segmentId],
    )

    return (updatedRows as UserProgressRow[])[0]
  })

  if (!result) {
    return validateError('更新进度失败', 500)
  }

  return validateSuccess(
    {
      segmentId: result.segment_id,
      ...mapProgressRow(result),
    },
    '更新进度成功',
    200,
  )
})
