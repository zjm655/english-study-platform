import { withTransaction, query } from '#server/utils/db'
import type { CheckinStatsRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader } from 'mysql2'

/**
 * 签到接口
 * 请求：POST /api/user/checkin
 * 流程：INSERT IGNORE log → 唯一键判重 → 计算连续性 → UPDATE stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats>> => {
  const userId: number = event.context.user.id

  const stats = await withTransaction(async (conn) => {
    // 1. INSERT IGNORE 打卡记录，唯一键 uk_user_date 防重复
    const [insertResult] = await conn.execute<ResultSetHeader>(
      'INSERT IGNORE INTO user_checkin_log (user_id, checkin_date) VALUES (?, CURDATE())',
      [userId]
    )

    // 2. affectedRows === 0 → 今天已签到
    if (insertResult.affectedRows === 0) {
      const rows = await query<CheckinStatsRow>(
        'SELECT * FROM user_checkin_stats WHERE user_id = ?',
        [userId]
      )
      return {
        alreadyCheckedIn: true,
        stats: rowToStats(rows[0]!)
      }
    }

    // 3. 查询 stats，判断连续性
    const statsRows = await query<CheckinStatsRow>(
      'SELECT * FROM user_checkin_stats WHERE user_id = ?',
      [userId]
    )
    const statsRow = statsRows[0]!
    const lastCheckinTime = statsRow.last_checkin_time

    let newStreak: number
    if (!lastCheckinTime) {
      // 首次签到
      newStreak = 1
    } else {
      const lastDate = new Date(lastCheckinTime)
      const now = new Date()
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)

      const isConsecutive =
        lastDate.getFullYear() === yesterday.getFullYear() &&
        lastDate.getMonth() === yesterday.getMonth() &&
        lastDate.getDate() === yesterday.getDate()

      newStreak = isConsecutive ? statsRow.current_streak_days + 1 : 1
    }

    const newMax = Math.max(newStreak, statsRow.max_streak_days)

    // 4. UPDATE stats
    await conn.execute(
      `UPDATE user_checkin_stats
       SET total_checkin_days = total_checkin_days + 1,
           last_checkin_time = NOW(),
           current_streak_days = ?,
           max_streak_days = ?
       WHERE user_id = ?`,
      [newStreak, newMax, userId]
    )

    return {
      alreadyCheckedIn: false,
      stats: {
        totalCheckinDays: statsRow.total_checkin_days + 1,
        lastCheckinTime: new Date().toISOString(),
        currentStreakDays: newStreak,
        maxStreakDays: newMax,
        totalStudyMinutes: statsRow.total_study_minutes
      }
    }
  })

  if (stats.alreadyCheckedIn) {
    return validateSuccess(stats.stats, '今日已签到')
  }

  return validateSuccess(stats.stats, '签到成功')
})

function rowToStats(row: CheckinStatsRow): CheckinStats {
  return {
    totalCheckinDays: row.total_checkin_days,
    lastCheckinTime: row.last_checkin_time,
    currentStreakDays: row.current_streak_days,
    maxStreakDays: row.max_streak_days,
    totalStudyMinutes: row.total_study_minutes
  }
}
