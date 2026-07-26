import { adminSegmentPath, adminSegmentBatchPath } from '../paths'
import type {
  AdminSegmentListQuery,
  AdminSegmentListResult,
  AdminSegmentDetail,
  AdminSegmentUpdatePayload,
  AdminSegmentVisibilityPayload,
} from '#shared/types/adminSegment'
import type { AuditionPayload, AuditionResult } from '#shared/types/adminPermission'
import type { AdminSegmentBatchPayload, BatchResult } from '#shared/types/adminBatch'

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

/** 管理员批量操作材料（delete=批量软删 / move=批量修改所属单元，部分成功语义） */
export const batchAdminSegments = (payload: AdminSegmentBatchPayload) => {
  return request.json<BatchResult>(adminSegmentBatchPath, {
    method: 'POST',
    body: payload,
  })
}

/** 审核门禁：材料试听解锁（填理由 + 留痕成功后返回签名 URL） */
export const auditionAdminSegment = (id: number, payload: AuditionPayload) => {
  return request.json<AuditionResult>(`${adminSegmentPath}/${id}/audition`, {
    method: 'POST',
    body: payload,
  })
}

/** 审核门禁：调整受限材料的公开状态（填理由 + 留痕成功后才变更） */
export const updateSegmentVisibility = (id: number, payload: AdminSegmentVisibilityPayload) => {
  return request.json<{ isPublic: number }>(`${adminSegmentPath}/${id}/visibility`, {
    method: 'PUT',
    body: payload,
  })
}
