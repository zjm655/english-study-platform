import { adminStatsPath } from '../paths'
import type {
  AdminStatsQuery,
  AdminStatsResult,
  CloudBalanceResult,
} from '#shared/types/adminStats'

/**
 * 运营统计聚合看板数据（概览 + 按天趋势 + Top10 + 错误分布）。
 * 服务端需对全范围 COUNT / GROUP BY，属耗时聚合读接口，故用 request.slow（默认 5s 易误中断）。
 */
export const getAdminStats = (options: AdminStatsQuery = {}) => {
  return request.slow<AdminStatsResult>(`${adminStatsPath}${buildQuery({ days: options.days })}`)
}

/** 云账户余额（阿里云 BSS，探索性；失败时 data.success=false）。外部云 API 调用，用 request.slow */
export const getAdminStatsCloud = () => {
  return request.slow<CloudBalanceResult>(`${adminStatsPath}/cloud`)
}
