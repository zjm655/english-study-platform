// server/api/admin/cloud/trend.get.ts
// 云服务调用趋势：按天聚合，返回日期序列 + 调用次数 + 总耗时（+ token）
// 参数：service (oss/nls/deepseek/edu)、days (7/30/90，默认 7)
//
// oss/nls/deepseek 走 cloud_service_call_log；edu 仅在 api_call_log 埋点
// （后端仅调 /api/evaluation/auth 鉴权，评测本身在前端 SDK），故单独分支聚合。
import { z } from 'zod'
import { validateSuccess, validateError } from '#server/utils/validate'
import { query } from '#server/utils/db'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

const querySchema = z.object({
  service: z.enum(['oss', 'nls', 'deepseek', 'edu']),
  days: z.coerce.number().int().min(1).max(90).default(7),
})

export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError('参数错误：service 需为 oss/nls/deepseek/edu，days 需为 1-90')
  }

  const { service, days } = parsed.data

  const dates: string[] = []
  const callCounts: number[] = []
  const totalDurations: number[] = []
  const totalTokens: number[] = []

  if (service === 'edu') {
    // edu：按天聚合 api_call_log 的评测鉴权成功调用次数（无耗时/token 维度，填 0）
    const rows = await query<{ date: string; call_count: number | string }>(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') as date, COUNT(*) as call_count
       FROM api_call_log
       WHERE route_pattern = ? AND method = ? AND status_code < 400
         AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
       ORDER BY date ASC`,
      ['/api/evaluation/auth', 'POST', days],
    )
    for (const row of rows) {
      dates.push(row.date)
      callCounts.push(Number(row.call_count))
      totalDurations.push(0)
      totalTokens.push(0)
    }
  } else {
    const rows = await query<{
      date: string
      call_count: number | string
      total_duration: number | string
      total_tokens: number | string
    }>(
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
    for (const row of rows) {
      dates.push(row.date)
      callCounts.push(Number(row.call_count))
      totalDurations.push(Number(row.total_duration))
      totalTokens.push(Number(row.total_tokens))
    }
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
