import { estimateServiceUsage } from '#server/utils/cloudEstimate'
import { getOssBucketStat } from '#server/utils/oss'
import { adminStatsQuerySchema, validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * OSS 对象存储用量（本地埋点估算 + 官方 GetBucketStat）
 * GET /api/admin/cloud/oss?days=7
 *
 * bucketStat 失败不阻断 estimate（独立降级）。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const parsed = adminStatsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0].message, 400)
  }
  const { days } = parsed.data

  const [estimate, bucketStat] = await Promise.all([
    estimateServiceUsage('oss', days),
    getOssBucketStat(),
  ])

  return validateSuccess({ estimate, bucketStat }, '获取 OSS 用量数据成功')
})
