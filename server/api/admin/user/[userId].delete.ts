import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员销号（软删除：置 user.deleted_at，数据保留可恢复）
 * DELETE /api/admin/user/[userId]
 *
 * 不做硬删除：recording/user_fav_segment/user_fav_word/user_progress 的 user_id 外键为
 * RESTRICT，直接 DELETE user 会被阻断；硬删除（含 OSS 清理）延后。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const userId = Number(getRouterParam(event, 'userId'))
  if (!userId || isNaN(userId)) {
    return validateError('无效的用户ID')
  }

  // 护栏：不能销号自己
  if (userId === user.id) {
    return validateError('不能销号自己', 400)
  }

  // 目标用户须存在且未注销
  const targetRows = await query<{ id: number; role: number; account: string }>(
    'SELECT id, role, account FROM user WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  if (targetRows.length === 0) {
    return validateError('用户不存在或已注销', 404)
  }
  const target = targetRows[0]!

  // 护栏：不能销号管理员（需先降权，降权能力本次未做）
  if (target.role === ROLE_ADMIN) {
    return validateError('不能销号管理员', 400)
  }

  const result = await query<ResultSetHeader>(
    'UPDATE user SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [userId],
  )
  const affectedRows = (result as unknown as ResultSetHeader).affectedRows ?? 0
  if (affectedRows === 0) {
    return validateError('用户不存在或已注销', 404)
  }

  await logAdminOperation(user.id, 'user.delete', 'user', userId, { account: target.account })
  return validateSuccess(null, '销号成功')
})
