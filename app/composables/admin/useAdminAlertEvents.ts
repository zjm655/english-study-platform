import { getAdminAlertEvents } from '~/api/admin/stats'
import type { AlertEventSummary } from '#shared/types/alertEvents'

/** 告警事件摘要（近 1 小时计数 + 最近 5 条；运营统计页独立加载，60s 服务端缓存） */
export const useAdminAlertEvents = () => {
  const cfg = createResCfg<null, AlertEventSummary>({
    handle: () => getAdminAlertEvents(),
    success: '',
    clientFail: '获取告警事件失败',
    serverFail: '服务器异常，获取告警事件失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
