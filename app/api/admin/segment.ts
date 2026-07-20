import { adminSegmentPath } from '../paths'
import type {
  AdminSegmentListQuery,
  AdminSegmentListResult,
  AdminSegmentDetail,
  AdminSegmentUpdatePayload,
} from '#shared/types/adminSegment'

/**
 * 管理员材料列表（服务端分页 + 筛选 + 搜索）。
 * query 参数手动拼接 URLSearchParams；unitId/isPublic 可能为 0，须用 !== undefined/null 判断。
 */
export const getAdminSegmentList = (options: AdminSegmentListQuery = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined && options.page !== null) params.append('page', String(options.page))
  if (options.pageSize !== undefined && options.pageSize !== null) params.append('pageSize', String(options.pageSize))
  if (options.unitId !== undefined && options.unitId !== null) params.append('unitId', String(options.unitId))
  if (options.isPublic !== undefined && options.isPublic !== null) params.append('isPublic', String(options.isPublic))
  if (options.keyword) params.append('keyword', options.keyword)
  const query = params.toString()
  return request.json<AdminSegmentListResult>(`${adminSegmentPath}${query ? '?' + query : ''}`)
}

/** 管理员材料详情（编辑页加载用） */
export const getAdminSegmentDetail = (id: number) => {
  return request.json<AdminSegmentDetail>(`${adminSegmentPath}/${id}`)
}

/** 管理员编辑材料（仅保存文本字段，不触发 TTS/AI 再生成） */
export const updateAdminSegment = (id: number, payload: AdminSegmentUpdatePayload) => {
  return request.json<null>(`${adminSegmentPath}/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

/** 管理员软删除材料 */
export const deleteAdminSegment = (id: number) => {
  return request.json<null>(`${adminSegmentPath}/${id}`, {
    method: 'DELETE',
  })
}
