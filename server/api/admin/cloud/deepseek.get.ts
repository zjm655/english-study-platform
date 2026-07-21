import { getDeepSeekBalance } from '#server/utils/deepseek'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * DeepSeek 账户余额查询
 * GET /api/admin/cloud/deepseek
 *
 * 复用 runtimeConfig.deepseek.apiKey（Bearer Token），带 5min 内存缓存。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const balance = await getDeepSeekBalance()

  return validateSuccess(
    { balance },
    balance.success ? '获取 DeepSeek 余额成功' : 'DeepSeek 余额暂不可用',
  )
})
