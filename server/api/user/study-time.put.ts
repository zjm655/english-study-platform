import { withTransaction } from '#server/utils/db'
import { formatDate, getStats } from '#server/services/checkinHelper'
import type { CheckinLogRow } from '#server/types/db'
import type { CheckinStats } from '#shared/types/user'
import type { ResultSetHeader } from 'mysql2'
import type { ZodSafeParseResult } from 'zod'

/** 单次上报最大学习时长（秒）：1小时 */
const MAX_STUDY_SECONDS_PER_REPORT = 3600

/**
 * 上报学习时长接口
 * 请求：PUT /api/user/study-time
 * Body：{ studySeconds: number }
 * 流程：查/创建 log → 校验上报时长 → 更新 log + stats
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId: number = event.context.user.id
  const body = await readBody(event)

  // zod 校验
  const result: ZodSafeParseResult<{ studySeconds: number }> = studyTimeSchema.safeParse(body)
  if (!result.success) {
    const errorMessage = result.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage)
  }

  const reportedSeconds = result.data.studySeconds
  const todayStr = formatDate(new Date())

  const stats = await withTransaction(async (conn) => {
    // 1. 查今天的 log 记录（事务内必须用 conn.execute）
    const [logRows] = await conn.execute(
      'SELECT * FROM user_checkin_log WHERE user_id = ? AND checkin_date = ?',
      [userId, todayStr],
    )
    const todayLog = (logRows as CheckinLogRow[])[0]

    // 2. 没有 log → 创建（未签到），首次调用以当前时间为基准
    if (!todayLog) {
      await conn.execute<ResultSetHeader>(
        'INSERT IGNORE INTO user_checkin_log (user_id, checkin_date, checked_in) VALUES (?, ?, 0)',
        [userId, todayStr],
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

    // 5. 更新 log（updatedAt 自动刷新）+ stats
    await conn.execute(
      'UPDATE user_checkin_log SET study_seconds = study_seconds + ? WHERE id = ?',
      [addSeconds, todayLog.id],
    )

    await conn.execute(
      'UPDATE user_checkin_stats SET total_study_seconds = total_study_seconds + ? WHERE user_id = ?',
      [addSeconds, userId],
    )

    // 6. 返回更新后的 stats
    return getStats(conn, userId)
  })

  return validateSuccess(stats, '更新成功')
})
