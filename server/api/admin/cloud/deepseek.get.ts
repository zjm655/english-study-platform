import { getDeepSeekBalance } from '#server/utils/deepseek'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * DeepSeek 账户余额查询
 * GET /api/admin/cloud/deepseek
 *
 * 复用 runtimeConfig.deepseek.apiKey（Bearer Token），带 5min 内存缓存。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const balance = await getDeepSeekBalance()

  return validateSuccess(
    { balance },
    balance.success ? '获取 DeepSeek 余额成功' : 'DeepSeek 余额暂不可用',
  )
})
