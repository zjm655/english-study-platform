// server/api/user/profile.put.ts
import { query } from '#server/utils/db'
import { userProfileUpdateSchema } from '#shared/schemas/user'
import type { ResPayload } from '#shared/types/request'

/**
 * 修改个人资料（当前仅昵称）
 * 请求：PUT /api/user/profile
 * Body：{ nickname }
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  const userId = event.context.user.id

  // 1. zod 校验（trim 后 1-25 字）
  const body = await readBody(event)
  const parsed = userProfileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败')
  }

  // 2. 更新昵称（parsed.data.nickname 已被 zod trim）
  await query('UPDATE user SET nickname = ? WHERE id = ?', [parsed.data.nickname, userId])

  return validateSuccess(null, '修改成功')
})
