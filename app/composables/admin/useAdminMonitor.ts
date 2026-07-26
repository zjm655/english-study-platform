import { getAdminMonitor } from '~/api/admin/monitor'
import type { AdminMonitorSnapshot } from '#shared/types/adminMonitor'

/** 运行监控快照（轮询专用，调用侧以 { silent: true } 静默执行） */
export const useAdminMonitor = () => {
  const cfg = createResCfg<null, AdminMonitorSnapshot>({
    handle: () => getAdminMonitor(),
    success: '',
    clientFail: '获取监控数据失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}
