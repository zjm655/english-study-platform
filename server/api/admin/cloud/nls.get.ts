import { estimateServiceUsage } from '#server/utils/cloudEstimate'
import { adminStatsQuerySchema, validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * NLS 智能语音交互用量（本地埋点估算）
 * GET /api/admin/cloud/nls?days=7
 *
 * 暂无官方查询接口示例，仅使用本地埋点估算。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const parsed = adminStatsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { days } = parsed.data

  const estimate = await estimateServiceUsage('nls', days)

  return validateSuccess({ estimate }, '获取 NLS 用量数据成功')
})
