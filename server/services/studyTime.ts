// server/services/studyTime.ts
// 学习时长累计核心（从 api/user/study-time.put.ts 抽出，供登录用户与游客上报共用，消除双源漂移）。
//
// 事务内执行，调用方负责 withTransaction 包裹。防作弊逻辑（服务端间隔校验、单报封顶）与
// 原登录用户路径逐字节等价；游客路径额外传 dailyCapSeconds 做单日封顶。
import type { PoolConnection } from 'mysql2/promise'
import type { ResultSetHeader } from 'mysql2'
import { formatDate, getStats } from './checkinHelper'
import type { CheckinLogRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'

/** 单次上报最大学习时长（秒）：1 小时 */
const MAX_STUDY_SECONDS_PER_REPORT = 3600

/**
 * 累计学习时长（事务内调用）。
 * @param conn            事务连接
 * @param userId          用户/游客 user 行 id
 * @param reportedSeconds 前端上报秒数
 * @param opts.dailyCapSeconds 单日累计上限（游客防刷用）；不传=不封顶（登录用户，行为不变）
 * @returns 更新后的 CheckinStats
 */
export async function accumulateStudyTime(
  conn: PoolConnection,
  userId: number,
  reportedSeconds: number,
  opts?: { dailyCapSeconds?: number },
): Promise<CheckinStats> {
  const cap = opts?.dailyCapSeconds
  const todayStr = formatDate(new Date())

  // 1. 查今天的 log 记录
  const [logRows] = await conn.execute(
    'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = ?',
    [userId, todayStr],
  )
  const todayLog = (logRows as CheckinLogRow[])[0]

  // 2. 没有 log → 创建（未签到），首次调用以当前时间为基准，不累计
  if (!todayLog) {
    await conn.execute<ResultSetHeader>(
      'INSERT IGNORE INTO user_checkin_log (user_id, checkin_date, checked_in) VALUES (?, ?, 0)',
      [userId, todayStr],
    )
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
  let actualSeconds = reportedSeconds

  // 服务端间隔比上报时长少了 10s 以上 → 异常，不累计
  if (intervalSeconds < reportedSeconds - 10) {
    return getStats(conn, userId)
  }

  // 上报超过间隔 → 封顶 1 小时
  if (actualSeconds > intervalSeconds) {
    actualSeconds = Math.min(actualSeconds, MAX_STUDY_SECONDS_PER_REPORT)
  }

  const addSeconds = Math.floor(actualSeconds)
  if (addSeconds <= 0) {
    return getStats(conn, userId)
  }

  // 5. 更新 log + stats。stats 累加取「实际增量」：
  //    - 无 cap（登录用户）：原子自增，增量 = addSeconds（与原逻辑逐字节等价）
  //    - 有 cap（游客）：按预读值算封顶后的确定新值，实际增量可能小于 addSeconds（已达上限时为 0）
  let realDelta = addSeconds
  if (cap != null) {
    const current = todayLog.study_seconds
    const newVal = Math.min(current + addSeconds, cap)
    realDelta = Math.max(0, newVal - current)
    if (realDelta <= 0) {
      return getStats(conn, userId) // 已达单日上限，不再累计
    }
    await conn.execute('UPDATE user_checkin_log SET study_seconds = ? WHERE id = ?', [
      newVal,
      todayLog.id,
    ])
  } else {
    await conn.execute('UPDATE user_checkin_log SET study_seconds = study_seconds + ? WHERE id = ?', [
      addSeconds,
      todayLog.id,
    ])
  }

  await conn.execute(
    'UPDATE user_checkin_stats SET total_study_seconds = total_study_seconds + ? WHERE user_id = ?',
    [realDelta, userId],
  )

  return getStats(conn, userId)
}
