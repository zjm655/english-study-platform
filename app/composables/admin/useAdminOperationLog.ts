import { getAdminOperationLogList } from '~/api/admin/operationLog'
import type { AdminOperationLogListQuery, AdminOperationLogListResult } from '#shared/types/adminOperationLog'

/** 全局操作日志列表 */
export const useAdminOperationLogList = () => {
  const cfg = createResCfg<AdminOperationLogListQuery, AdminOperationLogListResult>({
    handle: getAdminOperationLogList,
    success: '',
    clientFail: '获取操作日志失败',
    serverFail: '服务器异常，获取日志失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
