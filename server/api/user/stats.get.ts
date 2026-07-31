// server/api/user/stats.get.ts
// 用户学习统计（登录用户 + 游客）：已完成片段数、配音平均分、最近学习时间
import { validateSuccess } from '#server/utils/validate'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'
import { query } from '#server/utils/db'

export default defineEventHandler(async (event) => {
  const userId = await resolveEffectiveUserId(event)
  if (!userId) {
    return validateSuccess({ completedSegments: 0, avgDubbingScore: null, lastStudyTime: null }, '获取成功')
  }

  const completedRows = await query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM user_progress WHERE user_id = ? AND phase4_done = 1`,
    [userId],
  )
  const completedSegments = Number(completedRows[0]?.cnt ?? 0)

  const scoreRows = await query<{ avg_score: number | string | null }>(
    `SELECT AVG(score) as avg_score FROM recording WHERE user_id = ? AND phase = 3 AND score IS NOT NULL`,
    [userId],
  )
  const avgDubbingScore =
    scoreRows[0]?.avg_score != null ? Math.round(Number(scoreRows[0].avg_score) * 10) / 10 : null

  // 最近学习时间：取 user_progress 最后更新 与 recording 最后创建 的较大值
  // （user_progress.updatedAt 仅在阶段完成时刷新，recording.createdAt 每次评测必新增）
  const timeRows = await query<{ last_time: string | null }>(
    `SELECT GREATEST(
      COALESCE((SELECT MAX(updatedAt) FROM user_progress WHERE user_id = ? AND deleted_at IS NULL), '1970-01-01'),
      COALESCE((SELECT MAX(createdAt) FROM recording WHERE user_id = ? AND deleted_at IS NULL), '1970-01-01')
    ) AS last_time`,
    [userId, userId],
  )
  const rawTime = timeRows[0]?.last_time ?? null
  const lastStudyTime = rawTime && rawTime !== '1970-01-01' ? rawTime : null

  return validateSuccess({
    completedSegments,
    avgDubbingScore,
    lastStudyTime,
  })
})
