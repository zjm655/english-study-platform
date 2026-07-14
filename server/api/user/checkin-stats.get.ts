import { query } from '#server/utils/db'
import type { CheckinStatsRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'

/**
 * 获取用户打卡统计数据
 * 请求：GET /api/user/checkin-stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId = event.context.user.id

  const rows = await query<CheckinStatsRow>(
    'SELECT * FROM user_checkin_stats WHERE user_id = ?',
    [userId]
  )

  if (!rows.length) {
    return validateSuccess(null, '暂无打卡数据', 200)
  }

  const row = rows[0]!
  const stats: CheckinStats = {
    totalCheckinDays: row.total_checkin_days,
    lastCheckinTime: row.last_checkin_time,
    currentStreakDays: row.current_streak_days,
    maxStreakDays: row.max_streak_days,
    totalStudyMinutes: row.total_study_minutes
  }

  return validateSuccess(stats, '获取成功', 200)
})
