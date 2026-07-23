import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUserRoleSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 管理员变更用户角色（提升/降权）
 * PUT /api/admin/user/:userId/role
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

  const body = await readBody(event)
  const parsed = adminUserRoleSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { role: targetRole } = parsed.data

  // 不能修改自己
  if (userId === user.id) {
    return validateError('不能修改自己的角色', 400)
  }

  // 目标用户须存在且未注销
  const targetRows = await query<{ role: number }>(
    'SELECT role FROM user WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  if (targetRows.length === 0) {
    return validateError('用户不存在或已注销', 404)
  }
  const currentRole = targetRows[0]!.role

  // 已是目标角色
  if (currentRole === targetRole) {
    return validateError('角色无需变更', 400)
  }

  // 降权（1→0）：检查是否最后一个活跃管理员
  if (currentRole === ROLE_ADMIN && targetRole === 0) {
    const countRows = await query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM user WHERE role = 1 AND deleted_at IS NULL AND status = 1',
    )
    if (Number(countRows[0]?.cnt ?? 0) <= 1) {
      return validateError('必须保留至少一位管理员，无法降权', 400)
    }
  }

  await query('UPDATE user SET role = ? WHERE id = ?', [targetRole, userId])

  await logAdminOperation(user.id, 'user.role.update', 'user', userId, {
    before: currentRole,
    after: targetRole,
  })

  const actionText = targetRole === ROLE_ADMIN ? '已提升为管理员' : '已降级为普通用户'
  return validateSuccess(null, actionText)
})
