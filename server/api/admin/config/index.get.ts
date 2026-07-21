import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 获取系统配置
 * GET /api/admin/config
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const rows = await query<{ config_key: string; config_value: string; description: string | null }>(
    `SELECT config_key, config_value, description FROM sys_config ORDER BY config_key`,
  )

  const configs: Record<string, { value: string; description: string | null }> = {}
  for (const row of rows) {
    configs[row.config_key] = { value: row.config_value, description: row.description }
  }

  return validateSuccess(configs)
})
