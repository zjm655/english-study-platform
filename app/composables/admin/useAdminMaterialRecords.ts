import {
  getAdminMaterialRecordList,
  getAdminMaterialRecordStatuses,
  getAdminMaterialRecordDetail,
  deleteAdminMaterialRecord,
  batchAdminMaterialRecords,
  reprocessAdminMaterialRecord,
  auditionAdminMaterialRecord,
} from '~/api/admin/materialRecord'
import type {
  AdminMaterialRecordListQuery,
  AdminMaterialRecordListResult,
  AdminMaterialRecordDetail,
  AdminMaterialRecordReprocessPayload,
} from '#shared/types/adminMaterialRecord'
import type { AuditionPayload, AuditionResult } from '#shared/types/adminPermission'
import type { MaterialRecordStatusItem } from '#shared/types/material'
import type { AdminMaterialRecordBatchPayload, BatchResult } from '#shared/types/adminBatch'

/** 管理员上传记录列表 */
export const useAdminMaterialRecordList = () => {
  const cfg = createResCfg<AdminMaterialRecordListQuery, AdminMaterialRecordListResult>({
    handle: getAdminMaterialRecordList,
    success: '',
    clientFail: '获取上传记录失败',
    serverFail: '服务器异常，获取记录失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 批量查询上传任务状态（轮询专用，调用侧以 { silent: true } 静默执行） */
export const useAdminMaterialRecordStatuses = () => {
  const cfg = createResCfg<number[], MaterialRecordStatusItem[]>({
    handle: getAdminMaterialRecordStatuses,
    success: '',
    clientFail: '获取任务状态失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

/** 管理员上传记录详情 */
export const useAdminMaterialRecordDetail = () => {
  const cfg = createResCfg<number, AdminMaterialRecordDetail>({
    handle: getAdminMaterialRecordDetail,
    success: '',
    clientFail: '获取详情失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

/** 管理员删除上传记录 */
export const useDeleteAdminMaterialRecord = () => {
  const cfg = createResCfg<number, null>({
    handle: deleteAdminMaterialRecord,
    success: '删除成功',
    clientFail: '删除失败',
    serverFail: '服务器异常，删除失败',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

/** 管理员重处理失败记录 */
export const useReprocessAdminMaterialRecord = () => {
  const cfg = createResCfg<{ id: number; payload: AdminMaterialRecordReprocessPayload }, null>({
    handle: ({ id, payload }) => reprocessAdminMaterialRecord(id, payload),
    success: '重处理已提交',
    clientFail: '重处理失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

/** 管理员批量操作上传记录（delete=批量删除 / reprocess=批量重试；成功文案由页面按 BatchResult 汇总） */
export const useBatchAdminMaterialRecords = () => {
  const cfg = createResCfg<AdminMaterialRecordBatchPayload, BatchResult>({
    handle: batchAdminMaterialRecords,
    success: '',
    clientFail: '批量操作失败，请检查选中项',
    serverFail: '服务器异常，批量操作失败',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

/** 审核门禁：上传记录试听解锁（填理由→留痕→签名） */
export const useAuditionMaterialRecord = () => {
  const cfg = createResCfg<{ id: number; payload: AuditionPayload }, AuditionResult>({
    handle: ({ id, payload }) => auditionAdminMaterialRecord(id, payload),
    success: '',
    clientFail: '解锁失败，请检查填写内容',
    serverFail: '服务器异常，解锁失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
