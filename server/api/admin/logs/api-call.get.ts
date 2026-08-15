import { query } from '#server/utils/db'
import { adminApiCallLogListSchema } from '#shared/schemas/adminLogs'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * API 调用日志列表（管理员）
 * GET /api/admin/logs/api-call
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err

  const parsed = adminApiCallLogListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, method, statusCodeGroup, businessCode, pathKeyword, userId, startDate, endDate } =
    parsed.data
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: (string | number)[] = []

  if (method) {
    where.push('method = ?')
    params.push(method)
  }

  // 状态码分组为「HTTP 码 + 业务码」双维度：
  // 业务拒绝（validateError 默认码 400，额度/闸门/鉴权拒绝经 HTTP 200 + 业务码返回）与
  // HTTP 拒绝同等归组，不再被误归入「成功」。业务码镜像 HTTP 语义（>=400 为错误）。
  if (statusCodeGroup) {
    if (statusCodeGroup === 'success') {
      where.push('status_code < 400 AND (business_code IS NULL OR business_code < 400)')
    } else if (statusCodeGroup === '4xx') {
      where.push(
        'status_code BETWEEN 400 AND 499 OR (status_code < 400 AND business_code BETWEEN 400 AND 499)',
      )
    } else {
      where.push('status_code >= 500 OR (status_code < 400 AND business_code >= 500)')
    }
  }

  if (businessCode !== undefined) {
    where.push('business_code = ?')
    params.push(businessCode)
  }

  if (pathKeyword) {
    where.push('(path LIKE ? OR route_pattern LIKE ?)')
    params.push(`%${pathKeyword}%`, `%${pathKeyword}%`)
  }

  if (userId) {
    where.push('user_id = ?')
    params.push(userId)
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
    `SELECT id, path, route_pattern AS routePattern, method, status_code AS statusCode,
            business_code AS businessCode, duration_ms AS durationMs, user_id AS userId, ip,
            request_id AS requestId, error_message AS errorMessage, error_stack AS errorStack, createdAt
     FROM api_call_log ${whereSql}
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM api_call_log ${whereSql}`,
    params,
  )

  return validateSuccess(
    {
      list,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    },
    '获取 API 调用日志成功',
  )
})
