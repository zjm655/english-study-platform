import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUserStatusSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员封禁/解封用户（status: 0封禁 1正常）
 * PUT /api/admin/user/[userId]/status
 *
 * 封禁后由 auth 中间件在每次请求时查 DB 拦截，旧 token 即时失效。
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

  const body = await readBody(event)
  const parsed = adminUserStatusSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0].message, 400)
  }
  const { status } = parsed.data

  // 护栏：不能封禁/解封自己
  if (userId === user.id) {
    return validateError(status === 0 ? '不能封禁自己' : '不能对自己执行此操作', 400)
  }

  // 目标用户须存在且未注销
  const targetRows = await query<{ id: number; role: number; status: number; account: string }>(
    'SELECT id, role, status, account FROM user WHERE id = ? AND deleted_at IS NULL',
    [userId]
  )
  if (targetRows.length === 0) {
    return validateError('用户不存在或已注销', 404)
  }
  const target = targetRows[0]

  // 护栏：不能封禁/解封管理员（需先降权，降权能力本次未做）
  if (target.role === ROLE_ADMIN) {
    return validateError('不能对管理员执行此操作', 400)
  }

  if (target.status === status) {
    return validateError(status === 0 ? '该用户已处于封禁状态' : '该用户已处于正常状态', 400)
  }

  const result = await query<ResultSetHeader>(
    'UPDATE user SET status = ? WHERE id = ? AND deleted_at IS NULL',
    [status, userId]
  )
  const affectedRows = (result as unknown as ResultSetHeader).affectedRows ?? 0
  if (affectedRows === 0) {
    return validateError('操作失败，用户可能已注销', 400)
  }

  const action = status === 0 ? 'user.ban' : 'user.unban'
  await logAdminOperation(user.id, action, 'user', userId, { account: target.account, status })
  return validateSuccess(null, status === 0 ? '封禁成功' : '解封成功')
})
