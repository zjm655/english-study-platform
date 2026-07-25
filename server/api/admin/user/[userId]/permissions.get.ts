import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminUserPermissionDetail } from '#shared/types/adminPermission'

/**
 * 获取某用户的角色 + 已授予权限（授权管理页加载，超管专属）
 * GET /api/admin/user/:userId/permissions
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.GRANT_PERMISSIONS)
  if (err) return err

  const userId = Number(getRouterParam(event, 'userId'))
  if (!userId || isNaN(userId)) return validateError('无效的用户ID')

  const userRows = await query<{ role: number }>(
    'SELECT role FROM user WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  if (!userRows.length) return validateError('用户不存在或已注销', 404)

  const permRows = await query<{ permission_key: string }>(
    'SELECT permission_key FROM user_permission WHERE user_id = ?',
    [userId],
  )
  const detail: AdminUserPermissionDetail = {
    role: userRows[0]!.role,
    permissions: permRows.map((r) => r.permission_key),
  }
  return validateSuccess(detail, '获取用户权限成功')
})
