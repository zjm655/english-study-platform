import { query } from '#server/utils/db'
import {
  adminMaterialRecordListSchema,
  validateSuccess,
  validateError,
} from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import type {
  AdminMaterialRecordListItem,
  AdminMaterialRecordListResult,
} from '#shared/types/adminMaterialRecord'

/**
 * 管理员上传记录列表（分页 + 筛选 + JOIN user 获取用户名/角色）
 * GET /api/admin/material/records
 */
export default defineEventHandler(async (event) => {
  // 纵深防御
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const parsed = adminMaterialRecordListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, status, source, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  // 动态 WHERE
  const where: string[] = []
  const listParams: (number | string)[] = []
  const countParams: (number | string)[] = []

  if (status) {
    where.push('r.status = ?')
    listParams.push(status)
    countParams.push(status)
  }
  // source 筛选：按 user.role 过滤
  if (source === 'user') {
    where.push('u.role IS NOT NULL AND u.role != ?')
    listParams.push(ROLE_ADMIN)
    countParams.push(ROLE_ADMIN)
  } else if (source === 'admin') {
    where.push('u.role = ?')
    listParams.push(ROLE_ADMIN)
    countParams.push(ROLE_ADMIN)
  }
  if (startDate) {
    where.push('r.createdAt >= ?')
    listParams.push(startDate + ' 00:00:00')
    countParams.push(startDate + ' 00:00:00')
  }
  if (endDate) {
    where.push('r.createdAt < ?')
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    const nextDayStr = nextDay.toISOString().slice(0, 10)
    listParams.push(nextDayStr + ' 00:00:00')
    countParams.push(nextDayStr + ' 00:00:00')
  }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''

  // 列表查询
  const rows = await query<AdminMaterialRecordListItem & { role: number | null }>(
    `SELECT r.id, r.title, r.status, r.error_message, r.segment_id,
            r.is_public, r.createdAt,
            COALESCE(u.account, '已注销用户') AS username,
            u.role
     FROM material_upload_record r
     LEFT JOIN user u ON r.user_id = u.id
     ${whereSql}
     ORDER BY r.createdAt DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...listParams, pageSize, offset],
  )

  // 独立 COUNT
  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM material_upload_record r
     LEFT JOIN user u ON r.user_id = u.id
     ${whereSql}`,
    countParams,
  )
  const total = Number(countRows[0]?.total ?? 0)

  // 映射 source 字段
  const list: AdminMaterialRecordListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as AdminMaterialRecordListItem['status'],
    error_message: row.error_message,
    segment_id: row.segment_id,
    is_public: row.is_public,
    username: row.username,
    source: row.role === ROLE_ADMIN ? 'admin' : 'user',
    createdAt: row.createdAt,
  }))

  const result: AdminMaterialRecordListResult = { list, total, page, pageSize }
  return validateSuccess(result, '获取上传记录列表成功')
})
