import { withTransaction } from '#server/utils/db'
import { getStats, isStreakBroken } from '#server/services/checkinHelper'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader } from 'mysql2'

/**
 * 连续天数刷新接口
 * 请求：POST /api/user/checkin-refresh
 * 职责：只重算连续性——若上次签到已跨天中断且 current_streak_days>0，则清零。
 *      不增加签到天数、不改 checkin.post.ts。
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId: number = event.context.user.id
  const now = new Date()

  const stats = await withTransaction(async (conn): Promise<CheckinStats> => {
    const current = await getStats(conn, userId)
    if (current.currentStreakDays > 0 && isStreakBroken(current.lastCheckinTime, now)) {
      await conn.execute<ResultSetHeader>(
        'UPDATE user_checkin_stats SET current_streak_days = 0 WHERE user_id = ?',
        [userId],
      )
      return { ...current, currentStreakDays: 0 }
    }
    return current
  })

  return validateSuccess(stats, '连续天数已刷新')
})
