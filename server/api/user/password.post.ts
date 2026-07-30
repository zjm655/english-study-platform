// server/api/user/password.post.ts
import bcrypt from 'bcrypt'
import { query } from '#server/utils/db'
import type { ResPayload } from '#shared/types/request'

/**
 * 修改密码：校验旧密码 → 更新 passwordHash → 清除会话强制重新登录
 * 请求：POST /api/user/password
 * Body：{ oldPassword, newPassword, confirmPassword }
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  const userId = event.context.user.id

  // 1. zod 校验（新密码走共享密码规则；两次一致且不与旧密码相同）
  const body = await readBody(event)
  const parsed = passwordChangeSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败')
  }
  const { oldPassword, newPassword } = parsed.data

  // 2. 查库比对旧密码
  const rows = await query<{ passwordHash: string }>('SELECT passwordHash FROM user WHERE id = ?', [
    userId,
  ])
  if (rows.length === 0) {
    return validateError('用户不存在', 404)
  }
  const match = await bcrypt.compare(oldPassword, rows[0]!.passwordHash)
  if (!match) {
    return validateError('旧密码不正确', 400)
  }

  // 3. 加密新密码并更新（cost=10 与注册接口对齐）
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await query('UPDATE user SET passwordHash = ? WHERE id = ?', [passwordHash, userId])

  // 4. 清除会话 cookie，强制重新登录（与 auth 中间件清坏 token 的方式一致）
  deleteCookie(event, 'token')

  return validateSuccess(null, '密码修改成功，请重新登录')
})
