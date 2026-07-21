// server/api/admin/cloud/trend.get.ts
// 云服务调用趋势：按天聚合 cloud_service_call_log，返回日期序列 + 调用次数 + 总耗时
// 参数：service (oss/nls/deepseek)、days (7/30/90，默认 7)
import { z } from 'zod'
import { validateSuccess, validateError } from '#server/utils/validate'
import { query } from '#server/utils/db'

const querySchema = z.object({
  service: z.enum(['oss', 'nls', 'deepseek']),
  days: z.coerce.number().int().min(1).max(90).default(7),
})

export default defineEventHandler(async (event) => {
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError('参数错误：service 需为 oss/nls/deepseek，days 需为 1-90')
  }

  const { service, days } = parsed.data

  const rows = await query<{
    date: string
    call_count: number | string
    total_duration: number | string
    total_tokens: number | string
  }>(
    `SELECT DATE(createdAt) as date,
            COUNT(*) as call_count,
            COALESCE(SUM(duration_ms), 0) as total_duration,
            COALESCE(SUM(total_tokens), 0) as total_tokens
     FROM cloud_service_call_log
     WHERE service = ? AND success = 1 AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(createdAt)
     ORDER BY date ASC`,
    [service, days]
  )

  const dates: string[] = []
  const callCounts: number[] = []
  const totalDurations: number[] = []
  const totalTokens: number[] = []

  for (const row of rows) {
    dates.push(row.date)
    callCounts.push(Number(row.call_count))
    totalDurations.push(Number(row.total_duration))
    totalTokens.push(Number(row.total_tokens))
  }

  return validateSuccess({
    service,
    days,
    dates,
    callCounts,
    totalDurations,
    totalTokens,
  })
})