import { getAdminStats, getAdminStatsCloud } from '~/api/admin/stats'
import type {
  AdminStatsQuery,
  AdminStatsResult,
  CloudBalanceResult,
} from '#shared/types/adminStats'

/** 运营统计聚合看板数据（概览 + 按天趋势 + Top10 + 错误分布） */
export const useAdminStats = () => {
  const cfg = createResCfg<AdminStatsQuery, AdminStatsResult>({
    handle: getAdminStats,
    success: '获取运营统计成功',
    clientFail: '获取运营统计失败',
    serverFail: '服务器异常，获取统计失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 云账户余额（阿里云 BSS，探索性；失败不弹错，由页面优雅降级） */
export const useAdminStatsCloud = () => {
  const cfg = createResCfg<undefined, CloudBalanceResult>({
    handle: () => getAdminStatsCloud(),
    success: '获取云账户余额成功',
    clientFail: '获取云账户余额失败',
    serverFail: '服务器异常，获取余额失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
