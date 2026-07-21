// server/api/user/stats.get.ts
// 用户学习统计：已完成片段数、配音平均分、最近学习时间
import { z } from 'zod'
import { validateSuccess, validateError } from '#server/utils/validate'
import { query } from '#server/utils/db'

const querySchema = z.object({
  // 无参数，从 event.context.user 获取 userId
})

export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  if (!userId) {
    return validateError('未登录')
  }

  const [completedRows] = await query<{ cnt: number | string }[]>(
    `SELECT COUNT(*) as cnt FROM user_progress WHERE user_id = ? AND phase4_done = 1`,
    [userId]
  )
  const completedSegments = Number(completedRows?.cnt ?? 0)

  const [scoreRows] = await query<{ avg_score: number | string | null }[]>(
    `SELECT AVG(score) as avg_score FROM recording WHERE user_id = ? AND phase = 3 AND score IS NOT NULL`,
    [userId]
  )
  const avgDubbingScore = scoreRows?.avg_score != null ? Math.round(Number(scoreRows.avg_score) * 10) / 10 : null

  const [timeRows] = await query<{ last_time: string | null }[]>(
    `SELECT MAX(updated_at) as last_time FROM user_progress WHERE user_id = ?`,
    [userId]
  )
  const lastStudyTime = timeRows?.last_time ?? null

  return validateSuccess({
    completedSegments,
    avgDubbingScore,
    lastStudyTime,
  })
})