import {
  getMaterialRecords,
  updateMaterialRecord,
  deleteMaterialRecord,
} from '~/api/material/records'
import type {
  MaterialUploadRecordListItem,
  UpdateMaterialRecordPayload,
} from '#shared/types/material'

export const useMaterialRecords = () => {
  const cfg = createResCfg<{ limit?: number; offset?: number }, MaterialUploadRecordListItem[]>({
    handle: getMaterialRecords,
    success: '',
    clientFail: '获取记录失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

export const useUpdateMaterialRecord = () => {
  const cfg = createResCfg<{ id: number; payload: UpdateMaterialRecordPayload }, null>({
    handle: ({ id, payload }) => updateMaterialRecord(id, payload),
    success: '更新成功',
    clientFail: '更新失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}

export const useDeleteMaterialRecord = () => {
  const cfg = createResCfg<number, null>({
    handle: deleteMaterialRecord,
    success: '删除成功',
    clientFail: '删除失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}
