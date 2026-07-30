import { estimateServiceUsage } from '#server/services/cloudEstimate'
import { getOssBucketStat } from '#server/utils/oss'
import { adminStatsQuerySchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * OSS 对象存储用量（本地埋点估算 + 官方 GetBucketStat）
 * GET /api/admin/cloud/oss?days=7
 *
 * bucketStat 失败不阻断 estimate（独立降级）。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const parsed = adminStatsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { days } = parsed.data

  const [estimate, bucketStat] = await Promise.all([
    estimateServiceUsage('oss', days),
    getOssBucketStat(),
  ])

  return validateSuccess({ estimate, bucketStat }, '获取 OSS 用量数据成功')
})
