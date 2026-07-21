import type { PoolConnection } from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import type { CheckinStatsRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 格式化为 MySQL DATETIME 字符串 YYYY-MM-DD HH:MM:SS */
export function formatDatetime(d: Date): string {
  return `${formatDate(d)} ${d.toTimeString().slice(0, 8)}`
}

/**
 * 判断连续签到是否已中断。
 * lastCheckinTime 的日期既非「今天」也非「昨天」则视为已断。
 * @param lastCheckinTime 上次签到时间（DB datetime 字符串或 Date），null 视为未中断
 * @param now 当前时间
 */
export function isStreakBroken(lastCheckinTime: string | Date | null, now: Date): boolean {
  if (!lastCheckinTime) return false
  const lastDate = new Date(lastCheckinTime)
  if (Number.isNaN(lastDate.getTime())) return false

  const lastStr = formatDate(lastDate)
  const todayStr = formatDate(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayStr = formatDate(yesterday)

  return lastStr !== todayStr && lastStr !== yesterdayStr
}

/** 查询并转换用户打卡统计 */
export async function getStats(conn: PoolConnection, userId: number): Promise<CheckinStats> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT * FROM user_checkin_stats WHERE user_id = ?',
    [userId],
  )
  const row = rows[0] as CheckinStatsRow | undefined
  if (!row) {
    return {
      totalCheckinDays: 0,
      lastCheckinTime: null,
      currentStreakDays: 0,
      maxStreakDays: 0,
      totalStudySeconds: 0,
    }
  }
  return {
    totalCheckinDays: row.total_checkin_days,
    lastCheckinTime: row.last_checkin_time,
    currentStreakDays: row.current_streak_days,
    maxStreakDays: row.max_streak_days,
    totalStudySeconds: row.total_study_seconds,
  }
}
