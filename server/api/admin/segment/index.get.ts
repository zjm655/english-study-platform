import { query } from '#server/utils/db'
import { adminSegmentListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminSegmentListItem, AdminSegmentListResult } from '#shared/types/adminSegment'

/**
 * 管理员材料列表（服务端分页 + 单元/公开状态筛选 + 标题搜索）
 * GET /api/admin/segment
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const parsed = adminSegmentListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, unitId, isPublic, keyword } = parsed.data
  const offset = (page - 1) * pageSize

  // 动态 WHERE（全部参数化，禁止字符串拼接值）
  const where: string[] = ['s.deleted_at IS NULL']
  const params: (number | string)[] = []
  if (unitId !== undefined) {
    where.push('s.unit_id = ?')
    params.push(unitId)
  }
  if (isPublic !== undefined) {
    where.push('s.is_public = ?')
    params.push(isPublic)
  }
  if (keyword) {
    where.push('s.title LIKE ?')
    params.push(`%${keyword}%`)
  }
  const whereSql = where.join(' AND ')

  // 列表只 SELECT 必要字段（不含 textContent/translation/questions 大字段）
  const list = await query<AdminSegmentListItem>(
    `SELECT s.id, s.title, s.unit_id AS unitId, u.title AS unitTitle,
            s.is_public AS isPublic, s.sort_order AS sortOrder, s.createdAt
     FROM segment s
     LEFT JOIN unit u ON s.unit_id = u.id
     WHERE ${whereSql}
     ORDER BY s.createdAt DESC, s.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  // 独立 COUNT（与主查询共享 WHERE，计数无需 JOIN unit）
  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM segment s WHERE ${whereSql}`,
    params,
  )
  const total = Number(countRows[0]?.total ?? 0)

  const result: AdminSegmentListResult = { list, total, page, pageSize }
  return validateSuccess(result, '获取材料列表成功')
})
