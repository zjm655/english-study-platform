import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import { adminAlertEventListSchema } from '#shared/schemas/adminLogs'

/**
 * 告警事件列表（A1：alert_event 管理端可见性，只读浏览）
 * GET /api/admin/logs/events?page=1&pageSize=20&source=task_fail
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err

  const parsed = adminAlertEventListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, source, level, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: (string | number)[] = []
  if (source) {
    where.push('source = ?')
    params.push(source)
  }
  if (level) {
    where.push('level = ?')
    params.push(level)
  }
  if (startDate) {
    where.push('createdAt >= ?')
    params.push(startDate + ' 00:00:00')
  }
  if (endDate) {
    where.push('createdAt < ?')
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    params.push(nextDay.toISOString().slice(0, 10) + ' 00:00:00')
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const list = await query<Record<string, unknown>>(
    `SELECT id, source, level, code, message, request_id AS requestId,
            user_id AS userId, context, createdAt
     FROM alert_event ${whereSql}
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM alert_event ${whereSql}`,
    params,
  )

  return validateSuccess(
    {
      list,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    },
    '获取告警事件成功',
  )
})
