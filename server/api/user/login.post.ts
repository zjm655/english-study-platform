import type { LoginPayload, LoginResPayload as LoginRes } from '#shared/types/user'
import type { ZodSafeParseResult } from 'zod'
import type { ResPayload } from '#shared/types/request'
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

  const { account, password, captchaToken, captchaCode } = result.data

  // 3. 查数据库验证用户
  const rows = await query<UserRow>(
    'SELECT id, account, nickname, email, role, status, deleted_at, passwordHash, avatarUrl, level FROM user WHERE account = ?',
    [account],
  )
  const user = rows[0]
  if (!user) {
    return validateError('账号不存在', 401)
  }

  // 3b. 销号/封禁拦截（在密码校验前，避免泄露账号存在性细节）
  if (user.deleted_at) {
    return validateError('账号已注销', 401)
  }
  if (user.status === 0) {
    return validateError('账号已被封禁，请联系管理员', 403)
  }

  // 4. 连错达阈值：强制图形验证码（用 428 与鉴权失效 401/403 区分，前端据此显示验证码）
  if (getFailCount(account) >= CAPTCHA_THRESHOLD) {
    const captchaOk = await verifyCaptcha(captchaToken ?? '', captchaCode ?? '')
    if (!captchaOk) {
      return validateError('请输入图形验证码', 428)
    }
  }

  // 5. 验证密码
  const isMatch = await bcrypt.compare(password, user.passwordHash)
  if (!isMatch) {
    recordFail(account)
    return validateError('密码错误', 401)
  }

  // 6. 登录成功：清零连续失败计数
  resetFail(account)

  // 7. 生成 JWT token
  const token = await signToken({ id: user.id, role: user.role })

  // 8. 写入 httpOnly Cookie
  setCookie(event, 'token', token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  // 9. 返回用户信息（排除密码）
  const { passwordHash, ...safeInfo } = user
  return validateSuccess(safeInfo, '登录成功！', 200)
})
