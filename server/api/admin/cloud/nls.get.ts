import { estimateServiceUsage } from '#server/services/cloudEstimate'
import { adminStatsQuerySchema } from '#shared/schemas/adminStats'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * NLS 智能语音交互用量（本地埋点估算）
 * GET /api/admin/cloud/nls?days=7
 *
 * 暂无官方查询接口示例，仅使用本地埋点估算。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const parsed = adminStatsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { days } = parsed.data

  const estimate = await estimateServiceUsage('nls', days)

  return validateSuccess({ estimate }, '获取 NLS 用量数据成功')
})
