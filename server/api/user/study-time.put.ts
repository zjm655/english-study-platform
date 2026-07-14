import { withTransaction, query } from '#server/utils/db'
import type { CheckinStatsRow, CheckinLogRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader } from 'mysql2'

/** 单次上报最大学习时长（分钟） */
const MAX_STUDY_MINUTES_PER_REPORT = 120

/**
 * 上报学习时长接口
 * 请求：PUT /api/user/study-time
 * Body：{ studyMinutes: number }
 * 流程：查/创建 log → 校验上报时长 → 更新 log + stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId: number = event.context.user.id
  const body = await readBody<{ studyMinutes: number }>(event)
  const reportedMinutes = body?.studyMinutes ?? 0

  if (reportedMinutes <= 0) {
    return validateError('学习时长必须大于 0')
  }

  const stats = await withTransaction(async (conn) => {
    // 1. 查今天的 log 记录
    const logRows = await query<CheckinLogRow>(
      'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = CURDATE()',
      [userId]
    )
    let todayLog = logRows[0]

    // 2. 没有 log → 创建（未签到），首次调用以 NOW() 为基准
    if (!todayLog) {
      await conn.execute<ResultSetHeader>(
        'INSERT IGNORE INTO user_checkin_log (user_id, checkin_date, checked_in) VALUES (?, CURDATE(), 0)',
        [userId]
      )
      // 重新查询拿到 updatedAt 作为基准
      const newRows = await query<CheckinLogRow>(
        'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = CURDATE()',
        [userId]
      )
      todayLog = newRows[0]!
      // 首次调用，没有历史时间可算，不累计
      const statsRows = await query<CheckinStatsRow>(
        'SELECT * FROM user_checkin_stats WHERE user_id = ?',
        [userId]
      )
      return rowToStats(statsRows[0]!)
    }

    // 3. 计算服务端时间间隔
    const updatedAt = new Date(todayLog.updatedAt)
    const now = new Date()
    const intervalSeconds = (now.getTime() - updatedAt.getTime()) / 1000

    // 间隔太短（< 10s）→ 忽略
    if (intervalSeconds < 10) {
      const statsRows = await query<CheckinStatsRow>(
        'SELECT * FROM user_checkin_stats WHERE user_id = ?',
        [userId]
      )
      return rowToStats(statsRows[0]!)
    }

    // 4. 校验上报时长
    const intervalMinutes = intervalSeconds / 60
    let actualMinutes = reportedMinutes

    // 服务端间隔比上报时长少了 10s 以上 → 异常，不累计
    if (intervalSeconds < reportedMinutes * 60 - 10) {
      const statsRows = await query<CheckinStatsRow>(
        'SELECT * FROM user_checkin_stats WHERE user_id = ?',
        [userId]
      )
      return rowToStats(statsRows[0]!)
    }

    // 上报超过间隔 → 封顶 120 分钟
    if (actualMinutes > intervalMinutes) {
      actualMinutes = Math.min(actualMinutes, MAX_STUDY_MINUTES_PER_REPORT)
    }

    const addMinutes = Math.floor(actualMinutes)
    if (addMinutes <= 0) {
      const statsRows = await query<CheckinStatsRow>(
        'SELECT * FROM user_checkin_stats WHERE user_id = ?',
        [userId]
      )
      return rowToStats(statsRows[0]!)
    }

    // 5. 更新 log（updatedAt 自动刷新）+ stats
    await conn.execute(
      'UPDATE user_checkin_log SET study_minutes = study_minutes + ? WHERE id = ?',
      [addMinutes, todayLog.id]
    )

    await conn.execute(
      'UPDATE user_checkin_stats SET total_study_minutes = total_study_minutes + ? WHERE user_id = ?',
      [addMinutes, userId]
    )

    // 6. 返回更新后的 stats
    const statsRows = await query<CheckinStatsRow>(
      'SELECT * FROM user_checkin_stats WHERE user_id = ?',
      [userId]
    )
    return rowToStats(statsRows[0]!)
  })

  return validateSuccess(stats, '更新成功')
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
