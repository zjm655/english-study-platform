import { query } from '#server/utils/db'
import { validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import { z } from 'zod'

/** 表名白名单（防注入） */
const TABLE_WHITELIST: Record<string, string> = {
  api_call_log: 'api_call_log',
  cloud_service_call_log: 'cloud_service_call_log',
  admin_operation_log: 'admin_operation_log',
}

const exportSchema = z.object({
  table: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD').optional(),
})

/**
 * 管理员导出日志表为 CSV
 * GET /api/admin/logs/export?table=api_call_log&startDate=2026-07-01&endDate=2026-07-21
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const parsed = exportSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { table, startDate, endDate } = parsed.data

  const safeTable = TABLE_WHITELIST[table]
  if (!safeTable) {
    return validateError('不支持的表名，可选：api_call_log / cloud_service_call_log / admin_operation_log', 400)
  }

  // 构建 WHERE
  const where: string[] = []
  const params: string[] = []
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
