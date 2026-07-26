/**
 * 前端 CSV 导出（管理后台选中行导出用）：
 * 转义逻辑镜像 server/api/admin/logs/export.get.ts —— BOM 头防 Excel 乱码、
 * 公式注入防护（= + - @ \t \r 开头前置单引号）、含逗号/引号/换行的字段双引号包裹。
 */
export function exportRowsToCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return

  const headers = Object.keys(rows[0]!)
  const csvLines = [headers.join(',')]
  for (const row of rows) {
    const line = headers
      .map((h) => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        const raw = typeof val === 'object' ? JSON.stringify(val) : String(val)
        // 防 CSV 公式注入：以 = + - @ 或制表符/回车开头的单元格前置单引号
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

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
