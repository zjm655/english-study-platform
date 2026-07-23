import { query } from '#server/utils/db'
import { adminOperationLogListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import type {
  AdminOperationLogItem,
  AdminOperationLogListResult,
} from '#shared/types/adminOperationLog'

/**
 * 全局操作日志列表（管理员查看所有操作记录）
 * GET /api/admin/operation-log
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const parsed = adminOperationLogListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, action, keyword } = parsed.data
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

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const list = await query<AdminOperationLogItem>(
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

  const result: AdminOperationLogListResult = {
    list,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  }

  return validateSuccess(result, '获取操作日志成功')
})
