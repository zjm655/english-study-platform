import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { invalidateQuotaCache } from '#server/utils/quotaChecker'
import { ROLE_ADMIN } from '#shared/utils/role'
import { z } from 'zod'

const updateSchema = z.object({
  key: z.string().min(1).max(50),
  value: z.string().min(1).max(255),
})

/**
 * 更新系统配置
 * PUT /api/admin/config  { key: 'daily_eval_limit', value: '30' }
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const body = await readBody(event)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { key, value } = parsed.data

  // 验证 key 存在
  const existing = await query<{ config_key: string }>(
    `SELECT config_key FROM sys_config WHERE config_key = ?`,
    [key],
  )
  if (!existing.length) {
    return validateError(`配置项 "${key}" 不存在`, 404)
  }

  await query(`UPDATE sys_config SET config_value = ? WHERE config_key = ?`, [value, key])

  // 使额度缓存失效
  if (key === 'daily_eval_limit') {
    invalidateQuotaCache()
  }

  // 审计留痕
  await logAdminOperation(user.id, 'config.update', 'sys_config', 0, { key, value })

  return validateSuccess(null, `配置 "${key}" 已更新为 "${value}"`)
})
