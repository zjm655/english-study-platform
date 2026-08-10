// server/api/admin/cloud/trend.get.ts
// 云服务调用趋势：按天聚合，返回完整日期序列 + 调用次数 + 总耗时（+ token）
// 参数：service (oss/nls/deepseek/edu)、days (7/30/90，默认 7)
//
// oss/nls/deepseek 走 cloud_service_call_log；edu 仅在 api_call_log 埋点
// （后端仅调 /api/evaluation/auth 鉴权，评测本身在前端 SDK），故单独分支聚合。
//
// 补零约定：GROUP BY 只返回有数据的日期，缺数据日期由 fillDailyZeros 对
// callCounts/totalDurations/totalTokens 各分量逐一补 0，保证前端折线/面积图
// 「无调用日期显示为 0」而非跨日直连。
import { z } from 'zod'
import { validateSuccess, validateError } from '#server/utils/validate'
import { query } from '#server/utils/db'
import { startDateOf } from '#server/utils/dateSeries'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

const querySchema = z.object({
  service: z.enum(['oss', 'nls', 'deepseek', 'edu']),
  days: z.coerce.number().int().min(1).max(90).default(7),
})

/** 按天聚合行（三个分支的查询结果统一口径） */
export interface TrendAggRow {
  date: string
  call_count: number | string
  total_duration?: number | string
  /** nls 分支专用：真实音频时长 biz_duration_ms 之和（useBizAsDuration 时作为 totalDurations） */
  total_biz?: number | string
  total_tokens?: number | string
}

/** 补零后的完整序列 */
export interface DailySeries {
  dates: string[]
  callCounts: number[]
  totalDurations: number[]
  totalTokens: number[]
}

/**
 * 按天补零：生成 [startDate, endDate] 完整日期序列（含首尾两天），
 * 缺失日期对 callCounts/totalDurations/totalTokens 各分量逐一补 0。
 *
 * - 日期递增用 Date.UTC 计算，纯字符串运算不受运行环境时区影响（与 SQL 的
 *   DATE_FORMAT('%Y-%m-%d') 输出格式一致）。
 * - opts.useBizAsDuration=true 时（nls 分支），totalDurations 取行内 total_biz
 *   （真实音频时长），其余分支取 total_duration（执行耗时）。
 */
export function fillDailyZeros(
  startDate: string,
  endDate: string,
  rows: TrendAggRow[],
  opts: { useBizAsDuration?: boolean } = {},
): DailySeries {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const dates: string[] = []
  const callCounts: number[] = []
  const totalDurations: number[] = []
  const totalTokens: number[] = []

  // 逐日推进：UTC 解析避免本地时区偏移，输出 YYYY-MM-DD
  const cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const pad = (n: number) => String(n).padStart(2, '0')
  while (cursor <= end) {
    const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`
    const row = byDate.get(date)
    dates.push(date)
    callCounts.push(row ? Number(row.call_count ?? 0) : 0)
    if (opts.useBizAsDuration) {
      totalDurations.push(row ? Number(row.total_biz ?? 0) : 0)
    } else {
      totalDurations.push(row ? Number(row.total_duration ?? 0) : 0)
    }
    totalTokens.push(row ? Number(row.total_tokens ?? 0) : 0)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { dates, callCounts, totalDurations, totalTokens }
}

export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError('参数错误：service 需为 oss/nls/deepseek/edu，days 需为 1-90')
  }

  const { service, days } = parsed.data

  // 区间终点取 DB 时区 CURDATE()（与 SQL 聚合同源，避免跨时区部署错位一天）。
  // 必须用 DATE_FORMAT 强制输出 YYYY-MM-DD 字符串：mysql2 dateStrings=false 时 CURDATE() 的
  // DATE 列会被转为 JS Date 对象，模板字符串拼接会产出 Invalid Date 导致补零序列全空（回归 329d4e7）。
  const [todayRow] = await query<{ today: string }>(
    "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
  )
  const today = todayRow?.today ?? new Date().toISOString().slice(0, 10)
  const startDate = startDateOf(today, days)

  let series: DailySeries

  if (service === 'edu') {
    // edu：按天聚合 api_call_log 的评测鉴权成功调用次数（无耗时/token 维度，填 0）
    const rows = await query<TrendAggRow>(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as call_count
       FROM api_call_log
       WHERE route_pattern = ? AND method = ? AND status_code < 400
         AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
       ORDER BY date ASC`,
      ['/api/evaluation/auth', 'POST', days],
    )
    series = fillDailyZeros(startDate, today, rows)
  } else if (service === 'nls') {
    // nls：仅统计计费识别调用（filetrans/speechToText，成功），总时长用真实音频时长 biz_duration_ms
    // （非执行耗时 duration_ms），与估算口径一致；createToken/sttFallback 不计入。
    const rows = await query<TrendAggRow>(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date,
              COUNT(*) as call_count,
              COALESCE(SUM(biz_duration_ms), 0) as total_biz
       FROM cloud_service_call_log
       WHERE service = 'nls' AND success = 1
         AND operation IN ('filetrans', 'speechToText')
         AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
       ORDER BY date ASC`,
      [days],
    )
    series = fillDailyZeros(startDate, today, rows, { useBizAsDuration: true })
  } else {
    const rows = await query<TrendAggRow>(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date,
              COUNT(*) as call_count,
              COALESCE(SUM(duration_ms), 0) as total_duration,
              COALESCE(SUM(total_tokens), 0) as total_tokens
       FROM cloud_service_call_log
       WHERE service = ? AND success = 1 AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
       ORDER BY date ASC`,
      [service, days],
    )
    series = fillDailyZeros(startDate, today, rows)
  }

  return validateSuccess({
    service,
    days,
    ...series,
  })
})
