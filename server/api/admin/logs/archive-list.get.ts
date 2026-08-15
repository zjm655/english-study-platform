import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import { adminArchiveListSchema } from '#shared/schemas/adminLogs'

/** 各归档表列别名映射（与原列表端点同构，前端列模板可直接复用；含 archivedAt） */
const COLUMN_MAP: Record<string, string> = {
  api_call_log_archive: `id, path, route_pattern AS routePattern, method, status_code AS statusCode,
    business_code AS businessCode, duration_ms AS durationMs, user_id AS userId, ip,
    request_id AS requestId, error_message AS errorMessage, error_stack AS errorStack,
    createdAt, archived_at AS archivedAt`,
  cloud_service_call_log_archive: `id, service, operation, request_id AS requestId, success,
    duration_ms AS durationMs, biz_duration_ms AS bizDurationMs, prompt_tokens AS promptTokens,
    completion_tokens AS completionTokens, total_tokens AS totalTokens,
    error_message AS errorMessage, createdAt, archived_at AS archivedAt`,
  admin_operation_log_archive: `id, admin_id AS adminId, action, target_type AS targetType,
    target_id AS targetId, detail, createdAt, archived_at AS archivedAt`,
}

/**
 * 归档表只读浏览（P2-B）：三张归档表的分页列表，只读不清理。
 * GET /api/admin/logs/archive-list?table=api_call_log_archive&page=1&pageSize=20
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err

  const parsed = adminArchiveListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { table, page, pageSize, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: (string | number)[] = []
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
    `SELECT ${COLUMN_MAP[table]}
     FROM \`${table}\` ${whereSql}
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM \`${table}\` ${whereSql}`,
    params,
  )

  return validateSuccess(
    {
      list,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    },
    '获取归档日志成功',
  )
})
