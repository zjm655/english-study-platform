import { adminStatsPath } from '../paths'
import type { AdminStatsQuery, AdminStatsResult, CloudBalanceResult } from '#shared/types/adminStats'

/**
 * 运营统计聚合看板数据（概览 + 按天趋势 + Top10 + 错误分布）。
 * query 参数手动拼接 URLSearchParams；仅在有值时附加。
 */
export const getAdminStats = (options: AdminStatsQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null) params.append('days', String(options.days))
  const query = params.toString()
  return request.json<AdminStatsResult>(`${adminStatsPath}${query ? '?' + query : ''}`)
}

/** 云账户余额（阿里云 BSS，探索性；失败时 data.success=false） */
export const getAdminStatsCloud = () => {
  return request.json<CloudBalanceResult>(`${adminStatsPath}/cloud`)
}
