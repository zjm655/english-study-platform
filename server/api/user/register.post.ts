// server/api/user/register.post.ts
import pool from '#server/utils/db'  // ← 加这一行
import type { RegisterPayload } from '#shared/types/user'
import type { ZodSafeParseResult } from 'zod'
import type { ResPayload } from "#shared/types/request"
import bcrypt from 'bcrypt'

/**
 * 注册接口：校验参数 → 检查唯一性 → 密码加密 → 写入数据库
 * 请求：POST /api/user/register
 * Body：{ account, password1, password2, nickname?, email? }
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  // 1. 读取请求体
  const body: RegisterPayload = await readBody(event)

  // 2. zod 校验
  const result: ZodSafeParseResult<RegisterPayload> = registerSchema.safeParse(body)

  if (!result.success) {
    const errorMessage = result.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage)
  }

  const { account, password1, nickname, email } = result.data

  // 3. 检查账号是否已存在
  const [accountRows] = await pool.execute(
    'SELECT id FROM user WHERE account = ?',
    [account]
  )
  if ((accountRows as any[]).length > 0) {
    return validateError('该账号已注册，请直接登录')
  }

  // 4. 如果填了邮箱，检查邮箱是否已绑定
  if (email) {
    const [emailRows] = await pool.execute(
      'SELECT id FROM user WHERE email = ?',
      [email]
    )
    if ((emailRows as any[]).length > 0) {
      return validateError('该邮箱已绑定其他账号')
    }
  }

  // 5. 密码加密
  const passwordHash = await bcrypt.hash(password1, 10)

  // 6. 写入数据库
  await pool.execute(
    'INSERT INTO user (account, passwordHash, nickname, email) VALUES (?, ?, ?, ?)',
    [account, passwordHash, nickname || null, email || null]
  )

  // 7. 返回成功
  return validateSuccess(null, '注册成功！')
})