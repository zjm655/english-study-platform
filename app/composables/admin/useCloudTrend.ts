import { getAdminCloudTrend } from '~/api/admin/cloud'
import type { CloudTrendQuery, CloudTrendResult } from '#shared/types/adminCloud'

/** 云服务调用趋势（按天聚合） */
export const useCloudTrend = () => {
  const cfg = createResCfg<CloudTrendQuery, CloudTrendResult>({
    handle: getAdminCloudTrend,
    success: '获取趋势数据成功',
    clientFail: '获取趋势数据失败',
    serverFail: '服务器异常，获取趋势数据失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
