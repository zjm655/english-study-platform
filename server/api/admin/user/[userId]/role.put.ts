import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUserRoleSchema } from '#shared/schemas/adminUser'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ROLE_ADMIN, ROLE_SUPER_ADMIN, isAdminOrAbove } from '#shared/utils/role'
import { ensurePermission, invalidateUserPermissions } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理员变更用户角色（提升/降权）
 * PUT /api/admin/user/:userId/role
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.GRANT_PERMISSIONS)
  if (err) return err
  const user = event.context.user

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

  // 保护唯一超管：现有超管角色不可经 API 变更（防降权）。
  // 叠加 schema 拒收 role=2，API 既无法再造超管、也无法降掉迁移 018 置定的唯一超管。
  if (currentRole === ROLE_SUPER_ADMIN) {
    return validateError('超级管理员角色受保护，不可变更', 403)
  }

  // 已是目标角色
  if (currentRole === targetRole) {
    return validateError('角色无需变更', 400)
  }

  // 降权（管理员/超管 → 普通用户）：确保系统始终保留至少一位管理员或超管，避免无人可管理。
  if (isAdminOrAbove(currentRole) && !isAdminOrAbove(targetRole)) {
    const countRows = await query<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM user WHERE role IN (1, 2) AND deleted_at IS NULL AND status = 1',
    )
    if (Number(countRows[0]?.cnt ?? 0) <= 1) {
      return validateError('必须保留至少一位管理员，无法降权', 400)
    }
  }

  await query('UPDATE user SET role = ? WHERE id = ?', [targetRole, userId])
  // 角色变更影响权限解析（超管隐式全权 / 降权失去管理权），精确失效目标用户权限缓存
  invalidateUserPermissions(userId)

  await logAdminOperation(user.id, 'user.role.update', 'user', userId, {
    before: currentRole,
    after: targetRole,
  })

  const actionText = targetRole === ROLE_ADMIN ? '已设为管理员' : '已降级为普通用户'
  return validateSuccess(null, actionText)
})
