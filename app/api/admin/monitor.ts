import { adminMonitorPath } from '../paths'
import { request } from '~/utils/request'
import type { AdminMonitorSnapshot } from '#shared/types/adminMonitor'

/** 运行监控聚合快照（队列水位/评测闸门/上传任务/埋点缓冲/限流滑窗） */
export const getAdminMonitor = () => request<AdminMonitorSnapshot>(adminMonitorPath)
