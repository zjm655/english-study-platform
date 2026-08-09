import { withTransaction, pool } from '#server/utils/db'
import { formatDate, formatDatetime, getStats } from '#server/services/checkinHelper'
import { resolveAndEnsureGuestUserId } from '#server/services/guestEnsure'
import type { CheckinLogRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader } from 'mysql2'

/**
 * 签到接口（登录用户 + 游客）
 * 请求：POST /api/user/checkin
 * 流程：查 log → 已签到则返回 / 未签到则更新 → 计算连续性 → UPDATE stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId = event.context.user?.id ?? (await resolveAndEnsureGuestUserId(event))
  if (!userId) return validateError('未登录', 401)
  const now = new Date()
  const todayStr = formatDate(now)
  const nowStr = formatDatetime(now)

  let result: { alreadyCheckedIn: boolean; stats: CheckinStats }
  try {
    result = await withTransaction(async (conn) => {
      // 1. 查今天的 log 记录（事务内必须用 conn.execute）
      const [logRows] = await conn.execute(
        'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = ?',
        [userId, todayStr],
      )
      const todayLog = (logRows as CheckinLogRow[])[0]

      // 2. 已签到 → 直接返回
      if (todayLog && todayLog.checked_in === 1) {
        return {
          alreadyCheckedIn: true,
          stats: await getStats(conn, userId),
        }
      }

      // 3. 处理 log 记录
      if (todayLog) {
        // 存在但未签到（study-time 创建的）→ 标记已签到
        await conn.execute<ResultSetHeader>(
          'UPDATE user_checkin_log SET checked_in = 1 WHERE id = ?',
          [todayLog.id],
        )
      } else {
        // 不存在 → 创建（已签到）
        await conn.execute<ResultSetHeader>(
          'INSERT INTO user_checkin_log (user_id, checkin_date, checked_in) VALUES (?, ?, 1)',
          [userId, todayStr],
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
        [nowStr, newStreak, newMax, userId],
      )

      return {
        alreadyCheckedIn: false,
        stats: {
          totalCheckinDays: stats.totalCheckinDays + 1,
          lastCheckinTime: nowStr,
          currentStreakDays: newStreak,
          maxStreakDays: newMax,
          totalStudySeconds: stats.totalStudySeconds,
        },
      }
    })
  } catch (err) {
    // 并发下两请求同时未读到 todayLog 都执行 INSERT，唯一键 uk_user_date 挡住重复；
    // 失败方在此捕获，返回「今日已签到」友好提示而非 500（数据一致，不会双计）。
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'ER_DUP_ENTRY'
    ) {
      logger.warn('[checkin] 并发签到冲突，视为今日已签到')
      const conn = await pool.getConnection()
      try {
        return validateSuccess(await getStats(conn, userId), '今日已签到')
      } finally {
        conn.release()
      }
    }
    throw err
  }

  if (result.alreadyCheckedIn) {
    return validateSuccess(result.stats, '今日已签到')
  }

  return validateSuccess(result.stats, '签到成功')
})
