import { query } from '#server/utils/db'
import {
  adminOperationLogListSchemaV2,
  validateSuccess,
  validateError,
} from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理员操作日志列表（统一日志管理子页）
 * GET /api/admin/logs/operation
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err

  const parsed = adminOperationLogListSchemaV2.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, action, keyword, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: (string | number)[] = []

  if (action) {
    where.push('ol.action = ?')
    params.push(action)
  }

  if (keyword) {
    where.push('(ol.target_type LIKE ? OR CAST(ol.target_id AS CHAR) LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }

  if (startDate) {
    where.push('ol.createdAt >= ?')
    params.push(startDate + ' 00:00:00')
  }
  if (endDate) {
    where.push('ol.createdAt < ?')
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    params.push(nextDay.toISOString().slice(0, 10) + ' 00:00:00')
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const list = await query<Record<string, unknown>>(
    `SELECT ol.id, ol.action, ol.target_type AS targetType, ol.target_id AS targetId,
            ol.detail, ol.createdAt, u.account AS adminAccount
     FROM admin_operation_log ol
     LEFT JOIN user u ON ol.admin_id = u.id
     ${whereSql}
     ORDER BY ol.createdAt DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM admin_operation_log ol ${whereSql}`,
    params,
  )

  return validateSuccess(
    {
      list,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    },
    '获取操作日志成功',
  )
})
