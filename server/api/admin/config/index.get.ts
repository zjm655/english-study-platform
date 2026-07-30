import { query } from '#server/utils/db'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 获取系统配置
 * GET /api/admin/config
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.CONFIG)
  if (err) return err

  const rows = await query<{
    config_key: string
    config_value: string
    description: string | null
  }>(`SELECT config_key, config_value, description FROM sys_config ORDER BY config_key`)

  const configs: Record<string, { value: string; description: string | null }> = {}
  for (const row of rows) {
    configs[row.config_key] = { value: row.config_value, description: row.description }
  }

  return validateSuccess(configs)
})
