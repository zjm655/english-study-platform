import {
  getAdminUnitList,
  createAdminUnit,
  updateAdminUnit,
  deleteAdminUnit,
  batchDeleteAdminUnits,
} from '~/api/admin/unit'
import type {
  AdminUnitListQuery,
  AdminUnitListResult,
  AdminUnitSavePayload,
} from '#shared/types/adminUnit'
import type { BatchResult } from '#shared/types/adminBatch'

/** 管理员单元列表（服务端分页 + 筛选 + 搜索） */
export const useAdminUnitList = () => {
  const cfg = createResCfg<AdminUnitListQuery, AdminUnitListResult>({
    handle: getAdminUnitList,
    success: '获取单元列表成功',
    clientFail: '获取单元列表失败',
    serverFail: '服务器异常，获取列表失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员新建单元 */
export const useCreateAdminUnit = () => {
  const cfg = createResCfg<AdminUnitSavePayload, { id: number }>({
    handle: createAdminUnit,
    success: '新建成功',
    clientFail: '新建失败，请检查填写内容',
    serverFail: '服务器异常，新建失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员编辑单元（title/description/level/sortOrder 四字段） */
export const useUpdateAdminUnit = () => {
  const cfg = createResCfg<{ id: number; data: AdminUnitSavePayload }, null>({
    handle: ({ id, data }) => updateAdminUnit(id, data),
    success: '保存成功',
    clientFail: '保存失败，请检查填写内容',
    serverFail: '服务器异常，保存失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员软删除单元（id=0 系统保留单元服务端拒绝） */
export const useDeleteAdminUnit = () => {
  const cfg = createResCfg<number, null>({
    handle: deleteAdminUnit,
    success: '删除成功',
    clientFail: '删除失败',
    serverFail: '服务器异常，删除失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员批量删除单元（软删除；成功文案由页面按 BatchResult 汇总） */
export const useBatchDeleteAdminUnits = () => {
  const cfg = createResCfg<number[], BatchResult>({
    handle: batchDeleteAdminUnits,
    success: '',
    clientFail: '批量删除失败，请检查选中项',
    serverFail: '服务器异常，批量删除失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
