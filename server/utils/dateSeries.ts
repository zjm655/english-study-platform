// server/utils/dateSeries.ts
// 按天序列通用工具：基于 DB 时区 CURDATE() 推算区间，供按天聚合接口补零使用。
//
// 约定：日期一律用 YYYY-MM-DD 字符串 + Date.UTC 运算（纯字符串推进，不受运行环境时区影响，
// 与 SQL 的 DATE_FORMAT('%Y-%m-%d') 输出一致）。

/** 由 today（YYYY-MM-DD，通常取自 SQL CURDATE()）推算区间起点：today - (days - 1) 天 */
export function startDateOf(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (days - 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
