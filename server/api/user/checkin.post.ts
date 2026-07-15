import { withTransaction, query } from '#server/utils/db'
import { formatDate, formatDatetime, getStats } from '#server/utils/checkinHelper'
import type { CheckinLogRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader } from 'mysql2'

/**
 * 签到接口
 * 请求：POST /api/user/checkin
 * 流程：查 log → 已签到则返回 / 未签到则更新 → 计算连续性 → UPDATE stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId: number = event.context.user.id
  const now = new Date()
  const todayStr = formatDate(now)
  const nowStr = formatDatetime(now)

  const result = await withTransaction(async (conn) => {
    // 1. 查今天的 log 记录
    const logRows = await query<CheckinLogRow>(
      'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = ?',
      [userId, todayStr]
    )
    const todayLog = logRows[0]

    // 2. 已签到 → 直接返回
    if (todayLog && todayLog.checked_in === 1) {
      return {
        alreadyCheckedIn: true,
        stats: await getStats(conn, userId)
      }
    }

    // 3. 处理 log 记录
    if (todayLog) {
      // 存在但未签到（study-time 创建的）→ 标记已签到
      await conn.execute<ResultSetHeader>(
        'UPDATE user_checkin_log SET checked_in = 1 WHERE id = ?',
        [todayLog.id]
      )
    } else {
      // 不存在 → 创建（已签到）
      await conn.execute<ResultSetHeader>(
        'INSERT INTO user_checkin_log (user_id, checkin_date, checked_in) VALUES (?, ?, 1)',
        [userId, todayStr]
      )
    }

    // 4. 查询 stats，判断连续性
    const stats = await getStats(conn, userId)
    const lastCheckinTime = stats.lastCheckinTime

    let newStreak: number
    if (!lastCheckinTime) {
      newStreak = 1
    } else {
      const lastDate = new Date(lastCheckinTime)
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)

      const isConsecutive =
        lastDate.getFullYear() === yesterday.getFullYear() &&
        lastDate.getMonth() === yesterday.getMonth() &&
        lastDate.getDate() === yesterday.getDate()

      newStreak = isConsecutive ? stats.currentStreakDays + 1 : 1
    }

    const newMax = Math.max(newStreak, stats.maxStreakDays)

    // 5. UPDATE stats
    await conn.execute(
      `UPDATE user_checkin_stats
       SET total_checkin_days = total_checkin_days + 1,
           last_checkin_time = ?,
           current_streak_days = ?,
           max_streak_days = ?
       WHERE user_id = ?`,
      [nowStr, newStreak, newMax, userId]
    )

    return {
      alreadyCheckedIn: false,
      stats: {
        totalCheckinDays: stats.totalCheckinDays + 1,
        lastCheckinTime: nowStr,
        currentStreakDays: newStreak,
        maxStreakDays: newMax,
        totalStudySeconds: stats.totalStudySeconds
      }
    }
  })

  if (result.alreadyCheckedIn) {
    return validateSuccess(result.stats, '今日已签到')
  }

  return validateSuccess(result.stats, '签到成功')
})
