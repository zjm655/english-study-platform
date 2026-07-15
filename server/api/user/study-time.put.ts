import { withTransaction, query } from '#server/utils/db'
import type { CheckinStatsRow, CheckinLogRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader, PoolConnection } from 'mysql2/promise'
import type { ZodSafeParseResult } from 'zod'
import type { RowDataPacket } from 'mysql2'

/** 单次上报最大学习时长（分钟） */
const MAX_STUDY_MINUTES_PER_REPORT = 120

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 查询并转换用户打卡统计 */
async function getStats(conn: PoolConnection, userId: number): Promise<CheckinStats> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT * FROM user_checkin_stats WHERE user_id = ?',
    [userId]
  )
  const row = rows[0] as CheckinStatsRow
  return {
    totalCheckinDays: row.total_checkin_days,
    lastCheckinTime: row.last_checkin_time,
    currentStreakDays: row.current_streak_days,
    maxStreakDays: row.max_streak_days,
    totalStudyMinutes: row.total_study_minutes
  }
}

/**
 * 上报学习时长接口
 * 请求：PUT /api/user/study-time
 * Body：{ studyMinutes: number }
 * 流程：查/创建 log → 校验上报时长 → 更新 log + stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId: number = event.context.user.id
  const body = await readBody(event)

  // zod 校验
  const result: ZodSafeParseResult<{ studyMinutes: number }> = studyTimeSchema.safeParse(body)
  if (!result.success) {
    const errorMessage = result.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage)
  }

  const reportedMinutes = result.data.studyMinutes
  const todayStr = formatDate(new Date())

  if (reportedMinutes < 0) {
    return validateError('学习时长不能为负数')
  }

  const stats = await withTransaction(async (conn) => {
    // 1. 查今天的 log 记录
    const logRows = await query<CheckinLogRow>(
      'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = ?',
      [userId, todayStr]
    )
    let todayLog = logRows[0]

    // 2. 没有 log → 创建（未签到），首次调用以当前时间为基准
    if (!todayLog) {
      await conn.execute<ResultSetHeader>(
        'INSERT IGNORE INTO user_checkin_log (user_id, checkin_date, checked_in) VALUES (?, ?, 0)',
        [userId, todayStr]
      )
      // 首次调用，没有历史时间可算，不累计
      return getStats(conn, userId)
    }

    // 3. 计算服务端时间间隔
    const updatedAt = new Date(todayLog.updatedAt)
    const now = new Date()
    const intervalSeconds = (now.getTime() - updatedAt.getTime()) / 1000

    // 间隔太短（< 10s）→ 忽略
    if (intervalSeconds < 10) {
      return getStats(conn, userId)
    }

    // 4. 校验上报时长
    const intervalMinutes = intervalSeconds / 60
    let actualMinutes = reportedMinutes

    // 服务端间隔比上报时长少了 10s 以上 → 异常，不累计
    if (intervalSeconds < reportedMinutes * 60 - 10) {
      return getStats(conn, userId)
    }

    // 上报超过间隔 → 封顶 120 分钟
    if (actualMinutes > intervalMinutes) {
      actualMinutes = Math.min(actualMinutes, MAX_STUDY_MINUTES_PER_REPORT)
    }

    const addMinutes = Math.floor(actualMinutes)
    if (addMinutes <= 0) {
      return getStats(conn, userId)
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
    return getStats(conn, userId)
  })

  return validateSuccess(stats, '更新成功')
})
