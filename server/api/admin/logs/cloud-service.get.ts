import { query } from '#server/utils/db'
import { adminCloudServiceLogListSchema } from '#shared/schemas/adminLogs'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 云服务调用日志列表（管理员）
 * GET /api/admin/logs/cloud-service
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err

  const parsed = adminCloudServiceLogListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, service, success, operationKeyword, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: (string | number)[] = []

  if (service) {
    where.push('service = ?')
    params.push(service)
  }

  if (success !== undefined) {
    where.push('success = ?')
    params.push(success)
  }

  if (operationKeyword) {
    where.push('operation LIKE ?')
    params.push(`%${operationKeyword}%`)
  }

  if (startDate) {
    where.push('createdAt >= ?')
    params.push(startDate + ' 00:00:00')
  }
  if (endDate) {
    where.push('createdAt < ?')
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    params.push(nextDay.toISOString().slice(0, 10) + ' 00:00:00')
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  const list = await query<Record<string, unknown>>(
    `SELECT id, service, operation, success, duration_ms AS durationMs,
            prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
            total_tokens AS totalTokens, error_message AS errorMessage, createdAt
     FROM cloud_service_call_log ${whereSql}
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM cloud_service_call_log ${whereSql}`,
    params,
  )

  return validateSuccess(
    {
      list,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    },
    '获取云服务调用日志成功',
  )
})
