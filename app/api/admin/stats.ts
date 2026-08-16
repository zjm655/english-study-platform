import { adminStatsPath, adminStatsAlertEventsPath } from '~/api/paths'
import type { AdminStatsQuery, AdminStatsResult } from '#shared/types/adminStats'
import type { AlertEventSummary } from '#shared/types/alertEvents'

/**
 * 运营统计聚合看板数据（概览 + 按天趋势 + Top10 + 错误分布）。
 * 服务端需对全范围 COUNT / GROUP BY，属耗时聚合读接口，故用 request.slow（默认 5s 易误中断）。
 */
export const getAdminStats = (options: AdminStatsQuery = {}) => {
  return request.slow<AdminStatsResult>(`${adminStatsPath}${buildQuery({ days: options.days })}`)
}

/**
 * 告警事件摘要（近 1 小时各来源计数 + 最近 5 条，60s 缓存）。
 * 独立于 stats 的 7/30/90 天聚合：事件是「近 1 小时」时间尺度，随页面加载/手动刷新拉取。
 */
export const getAdminAlertEvents = () => request<AlertEventSummary>(adminStatsAlertEventsPath)
