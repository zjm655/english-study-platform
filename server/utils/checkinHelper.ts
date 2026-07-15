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

/** 查询并转换用户打卡统计 */
export async function getStats(conn: PoolConnection, userId: number): Promise<CheckinStats> {
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
