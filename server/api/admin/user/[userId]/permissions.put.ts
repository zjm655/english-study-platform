import { readBody } from 'h3'
import { query, withTransaction } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission, invalidateUserPermissions } from '#server/services/permission'
import { PERMISSIONS, GRANTABLE_PERMISSIONS } from '#shared/utils/permission'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 覆盖式设置某用户的权限（超管专属；grant_permissions 不可下放）
 * PUT /api/admin/user/:userId/permissions   { permissions: string[] }
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.GRANT_PERMISSIONS)
  if (err) return err
  const user = event.context.user

  const userId = Number(getRouterParam(event, 'userId'))
  if (!userId || isNaN(userId)) return validateError('无效的用户ID')
  if (userId === user.id) return validateError('不能修改自己的权限', 400)

  const body = await readBody(event)
  const list: unknown = body?.permissions
  if (!Array.isArray(list)) return validateError('permissions 必须为数组', 400)
  const grantable = new Set<string>(GRANTABLE_PERMISSIONS)
  if (list.some((p) => typeof p !== 'string' || !grantable.has(p))) {
    return validateError('包含不可授予的权限键', 400)
  }
  const keys = [...new Set(list as string[])]

  const targetRows = await query<{ id: number; role: number }>(
    'SELECT id, role FROM user WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  if (!targetRows.length) return validateError('用户不存在或已注销', 404)
  // 仅可为管理员分配权限：普通用户不得持后台权限，超管本就隐式全权无需显式行。
  if (targetRows[0]!.role !== ROLE_ADMIN) {
    return validateError('仅可为管理员分配权限，请先将其设为管理员', 400)
  }

  // 覆盖式写入：先清后插（事务保证原子，避免清空后插入失败导致失权）
  await withTransaction(async (conn) => {
    await conn.execute('DELETE FROM user_permission WHERE user_id = ?', [userId])
    for (const key of keys) {
      await conn.execute(
        'INSERT INTO user_permission (user_id, permission_key, granted_by) VALUES (?, ?, ?)',
        [userId, key, user.id],
      )
    }
  })

  // 精确失效目标用户权限缓存，确保授权即时生效（不等 60s TTL）
  invalidateUserPermissions(userId)
  await logAdminOperation(user.id, 'user.permissions.update', 'user', userId, { permissions: keys })
  return validateSuccess(null, '权限已更新')
})
