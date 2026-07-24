import { adminSegmentPath } from '../paths'
import type {
  AdminSegmentListQuery,
  AdminSegmentListResult,
  AdminSegmentDetail,
  AdminSegmentUpdatePayload,
} from '#shared/types/adminSegment'

/**
 * 管理员材料列表（服务端分页 + 筛选 + 搜索）。
 * unitId/isPublic 可能为 0，buildQuery 会保留数字 0（仅跳过 undefined/null/空串）。
 */
export const getAdminSegmentList = (options: AdminSegmentListQuery = {}) => {
  return request.json<AdminSegmentListResult>(
    `${adminSegmentPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      unitId: options.unitId,
      isPublic: options.isPublic,
      keyword: options.keyword,
    })}`,
  )
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
