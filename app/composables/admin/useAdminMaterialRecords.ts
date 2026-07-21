import {
  getAdminMaterialRecordList,
  getAdminMaterialRecordDetail,
  deleteAdminMaterialRecord,
  reprocessAdminMaterialRecord,
} from '~/api/admin/materialRecord'
import type {
  AdminMaterialRecordListQuery,
  AdminMaterialRecordListResult,
  AdminMaterialRecordDetail,
  AdminMaterialRecordReprocessPayload,
} from '#shared/types/adminMaterialRecord'

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
  const cfg = createResCfg<
    { id: number; payload: AdminMaterialRecordReprocessPayload },
    null
  >({
    handle: ({ id, payload }) => reprocessAdminMaterialRecord(id, payload),
    success: '重处理已提交',
    clientFail: '重处理失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}