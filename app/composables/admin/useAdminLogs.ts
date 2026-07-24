import {
  getApiCallLogList,
  getCloudServiceLogList,
  getOperationLogListV2,
  cleanLogs,
} from '~/api/admin/logs'
import type {
  ApiCallLogListQuery,
  ApiCallLogListResult,
  CloudServiceLogListQuery,
  CloudServiceLogListResult,
  OperationLogListQueryV2,
} from '#shared/types/adminLogs'
import type { AdminOperationLogListResult } from '#shared/types/adminOperationLog'

/** API 调用日志列表 */
export const useApiCallLogList = () => {
  const cfg = createResCfg<ApiCallLogListQuery, ApiCallLogListResult>({
    handle: getApiCallLogList,
    success: '',
    clientFail: '获取 API 调用日志失败',
    serverFail: '服务器异常，获取日志失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 云服务调用日志列表 */
export const useCloudServiceLogList = () => {
  const cfg = createResCfg<CloudServiceLogListQuery, CloudServiceLogListResult>({
    handle: getCloudServiceLogList,
    success: '',
    clientFail: '获取云服务调用日志失败',
    serverFail: '服务器异常，获取日志失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 操作日志列表（统一日志管理子页用） */
export const useOperationLogListV2 = () => {
  const cfg = createResCfg<OperationLogListQueryV2, AdminOperationLogListResult>({
    handle: getOperationLogListV2,
    success: '',
    clientFail: '获取操作日志失败',
    serverFail: '服务器异常，获取日志失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 清理日志表（页面自行提示删除行数，故 success 留空不重复日志） */
export const useCleanLogs = () => {
  const cfg = createResCfg<{ table: string; days: number }, { deletedRows: number }>({
    handle: (payload) => cleanLogs(payload),
    success: '',
    clientFail: '清理失败',
    serverFail: '服务器异常，清理失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
