import type { LoginPayload, LoginResPayload as LoginRes } from "#shared/types/user"
import type { ZodSafeParseResult } from 'zod'
import type { ResPayload } from "#shared/types/request"
import type { UserRow } from '#server/types/db'

import { query } from '#server/utils/db'
import bcrypt from 'bcrypt'

/**
 * 登录接口：验证账号密码 → 生成 JWT → 写入 httpOnly Cookie
 * 请求：POST /api/user/login
 * Body：{ account: string, password: string }
 */
export default defineEventHandler(async (event): Promise<ResPayload<LoginRes | null>> => {
  // 1. 读取请求体
  const body: LoginPayload = await readBody(event)

  // 2. zod 校验
  const result: ZodSafeParseResult<LoginPayload> = loginSchema.safeParse(body)

  if (!result.success) {
    const errorMessage = result.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage, 401)
  }

  const { account, password } = result.data

  // 3. 查数据库验证用户
  const rows = await query<UserRow>(
    'SELECT id, account, nickname, email, role, passwordHash, avatarUrl, level FROM user WHERE account = ?',
    [account]
  )
  const user = rows[0]
  if (!user) {
    return validateError('账号不存在', 401)
  }

  // 4. 验证密码
  const isMatch = await bcrypt.compare(password, user.passwordHash)
  if (!isMatch) {
    return validateError('密码错误', 401)
  }

  // 5. 生成 JWT token
  const token = await signToken({ id: user.id, role: user.role })

  // 6. 写入 httpOnly Cookie
  setCookie(event, 'token', token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  // 7. 返回用户信息（排除密码）
  const { passwordHash, ...safeInfo } = user
  return validateSuccess(safeInfo, '登录成功！', 200)
})