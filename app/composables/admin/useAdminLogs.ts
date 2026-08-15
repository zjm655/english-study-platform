import {
  getApiCallLogList,
  getCloudServiceLogList,
  getOperationLogListV2,
  getReviewAccessLogList,
  cleanLogs,
  getLogArchiveStats,
  purgeLogArchive,
  getArchiveList,
  getAlertEvents,
} from '~/api/admin/logs'
import type {
  ApiCallLogListQuery,
  ApiCallLogListResult,
  CloudServiceLogListQuery,
  CloudServiceLogListResult,
  OperationLogListQueryV2,
  ReviewAccessLogListQuery,
  ReviewAccessLogListResult,
  LogArchiveStatsResult,
  ArchiveListResult,
  AlertEventListResult,
  ArchiveListQuery,
  AlertEventListQuery,
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

/** 审核留痕列表（view_audit 门禁） */
export const useReviewAccessLogList = () => {
  const cfg = createResCfg<ReviewAccessLogListQuery, ReviewAccessLogListResult>({
    handle: getReviewAccessLogList,
    success: '',
    clientFail: '获取审核留痕失败',
    serverFail: '服务器异常，获取留痕失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 归档清理日志表（迁入归档表；页面自行提示归档行数，故 success 留空不重复弹提示） */
export const useCleanLogs = () => {
  const cfg = createResCfg<{ table: string; days: number }, { archivedRows: number }>({
    handle: (payload) => cleanLogs(payload),
    success: '',
    clientFail: '归档失败',
    serverFail: '服务器异常，归档失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 归档表统计（静默加载，失败不打断页面主流程） */
export const useLogArchiveStats = () => {
  const cfg = createResCfg<null, LogArchiveStatsResult>({
    handle: () => getLogArchiveStats(),
    success: '',
    clientFail: '获取归档统计失败',
    serverFail: '服务器异常，获取归档统计失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 彻底删除归档（物理删除；页面自行提示删除行数） */
export const usePurgeLogArchive = () => {
  const cfg = createResCfg<{ table: string; days: number }, { deletedRows: number }>({
    handle: (payload) => purgeLogArchive(payload),
    success: '',
    clientFail: '删除归档失败',
    serverFail: '服务器异常，删除归档失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 告警事件列表（A1：只读浏览；payload 从 schema 推导，P3-H） */
export const useAlertEventList = () => {
  const cfg = createResCfg<AlertEventListQuery, AlertEventListResult>({
    handle: (payload) => getAlertEvents(payload),
    success: '',
    clientFail: '获取告警事件失败',
    serverFail: '服务器异常，获取告警事件失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 归档表只读浏览（P2-B：分页列表，静默加载，失败不打断页面主流程；payload 从 schema 推导，P3-H） */
export const useArchiveList = () => {
  const cfg = createResCfg<ArchiveListQuery, ArchiveListResult>({
    handle: (payload) => getArchiveList(payload),
    success: '',
    clientFail: '获取归档日志失败',
    serverFail: '服务器异常，获取归档日志失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
