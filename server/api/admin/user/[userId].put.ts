import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUserUpdateSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 管理员修改用户资料（nickname / email / level；本次不含角色变更）
 * PUT /api/admin/user/[userId]
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
  const parsed = adminUserUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { nickname, email, level } = parsed.data

  // 目标用户须存在且未注销
  const targetRows = await query<{
    id: number
    nickname: string | null
    email: string | null
    level: number
  }>('SELECT id, nickname, email, level FROM user WHERE id = ? AND deleted_at IS NULL', [userId])
  if (targetRows.length === 0) {
    return validateError('用户不存在或已注销', 404)
  }
  const target = targetRows[0]!

  // email 若变更为新的非空值，需查重（唯一约束，避免 DB 报错）
  if (email !== undefined && email != null && email !== target.email) {
    const dup = await query<{ id: number }>('SELECT id FROM user WHERE email = ? AND id != ?', [
      email,
      userId,
    ])
    if (dup.length > 0) {
      return validateError('该邮箱已被其他用户使用', 400)
    }
  }

  // 动态构建 UPDATE（仅更新传入的字段；undefined=不改，null=清空）
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  if (nickname !== undefined) {
    sets.push('nickname = ?')
    params.push(nickname)
    before.nickname = target.nickname
    after.nickname = nickname
  }
  if (email !== undefined) {
    sets.push('email = ?')
    params.push(email)
    before.email = target.email
    after.email = email
  }
  if (level !== undefined) {
    sets.push('level = ?')
    params.push(level)
    before.level = target.level
    after.level = level
  }

  if (sets.length === 0) {
    return validateError('没有需要修改的字段', 400)
  }

  await query(`UPDATE user SET ${sets.join(', ')} WHERE id = ?`, [...params, userId])

  await logAdminOperation(user.id, 'user.update', 'user', userId, { before, after })
  return validateSuccess(null, '修改成功')
})
