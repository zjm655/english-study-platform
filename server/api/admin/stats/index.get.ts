import { query } from '#server/utils/db'
import { adminStatsQuerySchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type {
  AdminStatsResult,
  StatsSummary,
  DailyTrendItem,
  TopPathItem,
} from '#shared/types/adminStats'

/** 看板结果短 TTL 缓存（统计非实时，60s 内共享结果，降低对 api_call_log 的重复大范围扫描）。
 *  days 受 zod 约束在 1-90，故 Map 最多 90 项，无需额外淘汰。 */
const CACHE_TTL_MS = 60_000
const statsCache = new Map<number, { result: AdminStatsResult; expireAt: number }>()

/**
 * 运营统计聚合看板（单一端点，一次返回全部 widget 数据）
 * GET /api/admin/stats?days=7
 *
 * 错误率口径：HTTP 状态码 >= 400。
 * 业务错误率口径：business_code != 200 且非 NULL（从 beforeResponse 钩子捕获的 body.code）。
 * 未认证调用数以 user_id IS NULL 补充安全视角。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const parsed = adminStatsQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { days } = parsed.data

  // 命中短 TTL 缓存直接返回，避免高频刷新看板时对 api_call_log 反复大范围扫描
  const cached = statsCache.get(days)
  if (cached && Date.now() < cached.expireAt) {
    return validateSuccess(cached.result, '获取运营统计成功')
  }

  // 时间范围下界（所有查询强制带此条件走 idx_created_at / idx_path_created 索引）
  const rangeCond = 'createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'

  // 1. 概览指标（单行聚合；SUM/ROUND 返回 DECIMAL 字符串，统一 Number 转换）
  const summaryRows = await query<Record<string, string | number | null>>(
    `SELECT
       COUNT(*) AS totalCalls,
       ROUND(AVG(duration_ms)) AS avgDuration,
       ROUND(SUM(status_code >= 400) / COUNT(*) * 100, 2) AS errorRate,
       ROUND(SUM(business_code IS NOT NULL AND business_code != 200)
             / NULLIF(SUM(business_code IS NOT NULL), 0) * 100, 2) AS businessErrorRate,
       COUNT(DISTINCT user_id) AS activeUsers,
       SUM(user_id IS NULL) AS unauthCalls,
       SUM(createdAt >= CURDATE()) AS todayCalls
     FROM api_call_log
     WHERE ${rangeCond}`,
    [days],
  )
  const s = summaryRows[0] ?? {}
  const summary: StatsSummary = {
    totalCalls: Number(s.totalCalls ?? 0),
    todayCalls: Number(s.todayCalls ?? 0),
    errorRate: Number(s.errorRate ?? 0),
    businessErrorRate: Number(s.businessErrorRate ?? 0),
    avgDuration: Number(s.avgDuration ?? 0),
    activeUsers: Number(s.activeUsers ?? 0),
    unauthCalls: Number(s.unauthCalls ?? 0),
  }

  // 2. 按天趋势（DATE_FORMAT 直接输出字符串，避免 mysql2 将 DATE 转为 JS Date 的时区问题）
  const trendRows = await query<Record<string, string | number>>(
    `SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS date,
            COUNT(*) AS count,
            SUM(status_code >= 400) AS errorCount,
            ROUND(AVG(duration_ms)) AS avgDuration
     FROM api_call_log
     WHERE ${rangeCond}
     GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
     ORDER BY date ASC`,
    [days],
  )
  const dailyTrend: DailyTrendItem[] = trendRows.map((r) => ({
    date: String(r.date),
    count: Number(r.count),
    errorCount: Number(r.errorCount),
    avgDuration: Number(r.avgDuration),
  }))

  // 3. 热门接口 Top 10
  const topRows = await query<Record<string, string | number>>(
    `SELECT path, method, COUNT(*) AS count, ROUND(AVG(duration_ms)) AS avgDuration
     FROM api_call_log
     WHERE ${rangeCond}
     GROUP BY path, method
     ORDER BY count DESC
     LIMIT 10`,
    [days],
  )
  const topPaths: TopPathItem[] = topRows.map((r) => ({
    path: String(r.path),
    method: String(r.method),
    count: Number(r.count),
    avgDuration: Number(r.avgDuration),
  }))

  // 4. 错误路径分布 Top 10（HTTP ≥ 400）
  const errRows = await query<Record<string, string | number>>(
    `SELECT path, method, COUNT(*) AS count, ROUND(AVG(duration_ms)) AS avgDuration
     FROM api_call_log
     WHERE ${rangeCond} AND status_code >= 400
     GROUP BY path, method
     ORDER BY count DESC
     LIMIT 10`,
    [days],
  )
  const errorPaths: TopPathItem[] = errRows.map((r) => ({
    path: String(r.path),
    method: String(r.method),
    count: Number(r.count),
    avgDuration: Number(r.avgDuration),
  }))

  const result: AdminStatsResult = { summary, dailyTrend, topPaths, errorPaths }
  statsCache.set(days, { result, expireAt: Date.now() + CACHE_TTL_MS })
  return validateSuccess(result, '获取运营统计成功')
})
