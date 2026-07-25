import { query } from '#server/utils/db'
import { reviewAccessLogListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { ReviewAccessLogItem, ReviewAccessLogListResult } from '#shared/types/adminLogs'

/**
 * 审核留痕列表（统一日志管理子页）——REVIEW 敏感操作的审计视图。
 * 门禁为独立权限 view_audit（监督 REVIEW 持有者，不复用 VIEW_LOGS，避免被监督者群体默认可见）。
 * GET /api/admin/logs/review-access
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_AUDIT)
  if (err) return err

  const parsed = reviewAccessLogListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, targetType, reasonCategory, keyword, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const params: (string | number)[] = []

  if (targetType) {
    where.push('ral.target_type = ?')
    params.push(targetType)
  }
  if (reasonCategory) {
    where.push('ral.reason_category = ?')
    params.push(reasonCategory)
  }
  if (keyword) {
    where.push('u.account LIKE ?')
    params.push(`%${keyword}%`)
  }
  if (startDate) {
    where.push('ral.createdAt >= ?')
    params.push(startDate + ' 00:00:00')
  }
  if (endDate) {
    where.push('ral.createdAt < ?')
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    params.push(nextDay.toISOString().slice(0, 10) + ' 00:00:00')
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  // 双 LEFT JOIN：操作者账号（销号后 NULL 显「已删除」）+ 被查看材料归属用户账号
  const list = await query<ReviewAccessLogItem>(
    `SELECT ral.id, ral.operator_id AS operatorId, u.account AS operatorAccount,
            ral.operator_role AS operatorRole, ral.target_type AS targetType,
            ral.target_id AS targetId, ral.target_user_id AS targetUserId,
            tu.account AS targetUserAccount, ral.reason_category AS reasonCategory,
            ral.reason, ral.ip, ral.createdAt
     FROM review_access_log ral
     LEFT JOIN user u ON ral.operator_id = u.id
     LEFT JOIN user tu ON ral.target_user_id = tu.id
     ${whereSql}
     ORDER BY ral.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  // COUNT 复用同 WHERE（keyword 条件引用 u.account，故保留 JOIN）
  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM review_access_log ral
     LEFT JOIN user u ON ral.operator_id = u.id
     ${whereSql}`,
    params,
  )

  const result: ReviewAccessLogListResult = {
    list,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  }
  return validateSuccess(result, '获取审核留痕成功')
})
