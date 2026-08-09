import { withTransaction } from '#server/utils/db'
import { accumulateStudyTime } from '#server/services/studyTime'
import { studyTimeSchema } from '#shared/schemas/user'
import type { CheckinStats } from '#shared/types/user'
import type { ZodSafeParseResult } from 'zod'

/**
 * 上报学习时长接口
 * 请求：PUT /api/user/study-time
 * Body：{ studySeconds: number }
 * 流程：查/创建 log → 校验上报时长 → 更新 log + stats（核心逻辑见 services/studyTime.ts）
 */
export default defineEventHandler(async (event): Promise<ResPayload<CheckinStats | null>> => {
  const userId: number = event.context.user.id
  const body = await readBody(event)

  // zod 校验
  const result: ZodSafeParseResult<{ studySeconds: number }> = studyTimeSchema.safeParse(body)
  if (!result.success) {
    const errorMessage = result.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage)
  }

  // 登录用户不封顶，行为与抽取前逐字节等价
  const stats = await withTransaction((conn) =>
    accumulateStudyTime(conn, userId, result.data.studySeconds),
  )

  return validateSuccess(stats, '更新成功')
})
