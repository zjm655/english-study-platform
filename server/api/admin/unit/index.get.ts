import { query } from '#server/utils/db'
import { adminUnitListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminUnitListItem, AdminUnitListResult } from '#shared/types/adminUnit'

/**
 * 管理员单元列表（服务端分页 + 难度筛选 + 标题搜索）
 * GET /api/admin/unit
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const parsed = adminUnitListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, level, keyword } = parsed.data
  const offset = (page - 1) * pageSize

  // 动态 WHERE（全部参数化，禁止字符串拼接值）
  const where: string[] = ['u.deleted_at IS NULL']
  const params: (number | string)[] = []
  if (level !== undefined) {
    where.push('u.level = ?')
    params.push(level)
  }
  if (keyword) {
    where.push('u.title LIKE ?')
    params.push(`%${keyword}%`)
  }
  const whereSql = where.join(' AND ')

  // 材料数用关联子查询统计：segment.unit_id 有索引，pageSize ≤ 50 时代价恒定
  const list = await query<AdminUnitListItem>(
    `SELECT u.id, u.title, u.description, u.level, u.sort_order AS sortOrder, u.createdAt,
            (SELECT COUNT(*) FROM segment s WHERE s.unit_id = u.id AND s.deleted_at IS NULL) AS segmentCount
     FROM unit u
     WHERE ${whereSql}
     ORDER BY u.level, u.sort_order, u.id
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  // 独立 COUNT（与主查询共享 WHERE）
  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM unit u WHERE ${whereSql}`,
    params,
  )
  const total = Number(countRows[0]?.total ?? 0)

  const result: AdminUnitListResult = { list, total, page, pageSize }
  return validateSuccess(result, '获取单元列表成功')
})
