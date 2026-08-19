import { getAdminMySql } from '~/api/admin/monitor'
import type { MySqlMonitorResult } from '#shared/types/mysqlMonitor'

/** MySQL 运行时健康状态（运行监控页 MySQL 面板，独立低频轮询 + 手动刷新，不随 5s 主轮询放大） */
export const useAdminMySql = () => {
  const cfg = createResCfg<null, MySqlMonitorResult>({
    handle: () => getAdminMySql(),
    success: '',
    clientFail: '获取 MySQL 状态失败',
    serverFail: '服务器异常，获取 MySQL 状态失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
