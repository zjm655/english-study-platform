import { query } from '#server/utils/db'
import { adminUserLogsSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import type { AdminOperationLogItem } from '#shared/types/adminOperationLog'

/**
 * 管理员查看某个用户的操作日志
 * GET /api/admin/user/:userId/logs
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const userId = Number(getRouterParam(event, 'userId'))
  if (!userId || isNaN(userId)) {
    return validateError('无效的用户ID')
  }

  const parsed = adminUserLogsSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize } = parsed.data
  const offset = (page - 1) * pageSize

  const list = await query<AdminOperationLogItem>(
    `SELECT ol.id, ol.action, ol.target_type AS targetType, ol.target_id AS targetId,
            ol.detail, ol.createdAt, u.account AS adminAccount
     FROM admin_operation_log ol
     LEFT JOIN user u ON ol.admin_id = u.id
     WHERE ol.target_type = 'user' AND ol.target_id = ?
     ORDER BY ol.createdAt DESC
     LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM admin_operation_log
     WHERE target_type = 'user' AND target_id = ?`,
    [userId],
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
