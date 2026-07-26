import { adminUnitPath, adminUnitBatchPath } from '../paths'
import type {
  AdminUnitListQuery,
  AdminUnitListResult,
  AdminUnitSavePayload,
} from '#shared/types/adminUnit'
import type { BatchResult } from '#shared/types/adminBatch'

/**
 * 管理员单元列表（服务端分页 + 难度筛选 + 标题搜索）。
 * level 可能为 0（自定义单元），buildQuery 会保留数字 0（仅跳过 undefined/null/空串）。
 */
export const getAdminUnitList = (options: AdminUnitListQuery = {}) => {
  return request.json<AdminUnitListResult>(
    `${adminUnitPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      level: options.level,
      keyword: options.keyword,
    })}`,
  )
}

/** 管理员新建单元 */
export const createAdminUnit = (payload: AdminUnitSavePayload) => {
  return request.json<{ id: number }>(adminUnitPath, {
    method: 'POST',
    body: payload,
  })
}

/** 管理员编辑单元（title/description/level/sortOrder 四字段） */
export const updateAdminUnit = (id: number, payload: AdminUnitSavePayload) => {
  return request.json<null>(`${adminUnitPath}/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

/** 管理员软删除单元（id=0 系统保留单元服务端拒绝） */
export const deleteAdminUnit = (id: number) => {
  return request.json<null>(`${adminUnitPath}/${id}`, {
    method: 'DELETE',
  })
}

/** 管理员批量删除单元（软删除，部分成功语义；id=0 系统保留单元进 skipped） */
export const batchDeleteAdminUnits = (ids: number[]) => {
  return request.json<BatchResult>(adminUnitBatchPath, {
    method: 'POST',
    body: { action: 'delete', ids },
  })
}
