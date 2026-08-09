/** 运营统计共享类型（API 调用埋点聚合看板） */
export type { AdminStatsQuery } from '../schemas/adminStats'

/** 概览指标（选定时间范围 + 今日） */
export interface StatsSummary {
  totalCalls: number // 选定范围总调用量
  todayCalls: number // 今日调用量
  errorRate: number // HTTP≥400 占比（0-100，保留两位小数）
  businessErrorRate: number // 业务错误码占比（business_code != 200 且非 NULL，0-100）
  avgDuration: number // 平均耗时 ms（取整）
  activeUsers: number // 去重调用用户数
  unauthCalls: number // 未认证调用数（user_id IS NULL，安全视角指标）
}

/** 按天聚合趋势项 */
export interface DailyTrendItem {
  date: string // YYYY-MM-DD
  count: number // 当日调用量
  errorCount: number // 当日 HTTP≥400 数
  avgDuration: number // 当日平均耗时 ms
}

/** 热门/错误路径聚合项 */
export interface TopPathItem {
  path: string
  method: string
  count: number
  avgDuration: number
}

/** 聚合看板完整响应 */
export interface AdminStatsResult {
  summary: StatsSummary
  dailyTrend: DailyTrendItem[]
  topPaths: TopPathItem[] // 调用量 Top 10
  errorPaths: TopPathItem[] // HTTP≥400 路径分布 Top 10
}

/** 云账户余额（阿里云 BSS，探索性） */
export interface CloudBalanceResult {
  success: boolean
  availableAmount?: string // 可用额度（含信用额度）
  availableCashAmount?: string // 可用现金
  creditAmount?: string // 信用额度
  currency?: string // 币种
  error?: string // 失败原因
}
