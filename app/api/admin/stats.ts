import { adminStatsPath } from '../paths'
import type { AdminStatsQuery, AdminStatsResult } from '#shared/types/adminStats'

/**
 * 运营统计聚合看板数据（概览 + 按天趋势 + Top10 + 错误分布）。
 * 服务端需对全范围 COUNT / GROUP BY，属耗时聚合读接口，故用 request.slow（默认 5s 易误中断）。
 */
export const getAdminStats = (options: AdminStatsQuery = {}) => {
  return request.slow<AdminStatsResult>(`${adminStatsPath}${buildQuery({ days: options.days })}`)
}
