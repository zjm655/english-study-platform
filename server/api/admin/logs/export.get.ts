import { query } from '#server/utils/db'
import { validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { PermissionKey } from '#shared/utils/permission'
import { z } from 'zod'

/** 表名白名单（防注入）→ 导出所需权限：常规日志表 VIEW_LOGS；审核留痕为审计数据，需 VIEW_AUDIT */
const TABLE_WHITELIST: Record<string, PermissionKey> = {
  api_call_log: PERMISSIONS.VIEW_LOGS,
  cloud_service_call_log: PERMISSIONS.VIEW_LOGS,
  admin_operation_log: PERMISSIONS.VIEW_LOGS,
  review_access_log: PERMISSIONS.VIEW_AUDIT,
}

const exportSchema = z.object({
  table: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD').optional(),
  // 选中行导出：逗号分隔正整数串，去重后 1~200 个（GET URL 长度约束，超出请改用时间范围）
  ids: z
    .string()
    .min(1)
    .transform((s) => [...new Set(s.split(','))].map((v) => Number(v.trim())))
    .refine((arr) => arr.length >= 1 && arr.length <= 200, 'ids 数量需在 1~200 之间')
    .refine((arr) => arr.every((n) => Number.isInteger(n) && n > 0), 'ids 必须为逗号分隔的正整数')
    .optional(),
})

/**
 * 管理员导出日志表为 CSV
 * GET /api/admin/logs/export?table=api_call_log&startDate=2026-07-01&endDate=2026-07-21
 * GET /api/admin/logs/export?table=api_call_log&ids=1,2,3（选中行导出，优先于日期条件）
 */
export default defineEventHandler(async (event) => {
  const parsed = exportSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { table, startDate, endDate, ids } = parsed.data

  const requiredPermission = TABLE_WHITELIST[table]
  if (!requiredPermission) {
    return validateError(
      '不支持的表名，可选：api_call_log / cloud_service_call_log / admin_operation_log / review_access_log',
      400,
    )
  }
  // 按表取所需权限再门禁：审核留痕表要求 view_audit，避免 VIEW_LOGS 持有者绕道导出审计数据
  const err = ensurePermission(event, requiredPermission)
  if (err) return err
  const safeTable = table

  // 构建 WHERE：ids（选中行导出）优先于日期条件
  const where: string[] = []
  const params: (string | number)[] = []
  if (ids && ids.length > 0) {
    where.push(`id IN (${ids.map(() => '?').join(', ')})`)
    params.push(...ids)
  } else {
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
  }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM ${safeTable} ${whereSql} ORDER BY createdAt DESC LIMIT 50000`,
    params,
  )

  if (!rows.length) {
    return validateError('范围内无数据', 404)
  }

  // 拼 CSV（BOM 头防 Excel 乱码）
  const headers = Object.keys(rows[0]!)
  const csvLines = [headers.join(',')]
  for (const row of rows) {
    const line = headers
      .map((h) => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        const raw = typeof val === 'object' ? JSON.stringify(val) : String(val)
        // 防 CSV 公式注入：以 = + - @ 或制表符/回车开头的单元格前置单引号，
        // 避免 Excel/WPS 把用户可控字段（account、api 路径等）当作公式执行（如 =HYPERLINK(...)）
        const str = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
        // 含逗号/引号/换行的字段用双引号包裹
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      })
      .join(',')
    csvLines.push(line)
  }
  const csv = '\uFEFF' + csvLines.join('\n')

  // 设置响应头，直接返回文件流
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${safeTable}_export.csv"`)
  return csv
})
