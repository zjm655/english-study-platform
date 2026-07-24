import {
  getAdminSegmentList,
  getAdminSegmentDetail,
  updateAdminSegment,
  deleteAdminSegment,
  auditionAdminSegment,
  updateSegmentVisibility,
} from '~/api/admin/segment'
import type {
  AdminSegmentListQuery,
  AdminSegmentListResult,
  AdminSegmentDetail,
  AdminSegmentUpdatePayload,
  AdminSegmentVisibilityPayload,
} from '#shared/types/adminSegment'
import type { AuditionPayload, AuditionResult } from '#shared/types/adminPermission'

/** 管理员材料列表（服务端分页 + 筛选 + 搜索） */
export const useAdminSegmentList = () => {
  const cfg = createResCfg<AdminSegmentListQuery, AdminSegmentListResult>({
    handle: getAdminSegmentList,
    success: '获取材料列表成功',
    clientFail: '获取材料列表失败',
    serverFail: '服务器异常，获取列表失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员材料详情（编辑页加载用） */
export const useAdminSegmentDetail = () => {
  const cfg = createResCfg<number, AdminSegmentDetail>({
    handle: getAdminSegmentDetail,
    success: '获取材料详情成功',
    clientFail: '获取材料详情失败',
    serverFail: '服务器异常，获取详情失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员编辑材料（仅保存文本字段，不触发 TTS/AI 再生成） */
export const useUpdateAdminSegment = () => {
  const cfg = createResCfg<{ id: number; data: AdminSegmentUpdatePayload }, null>({
    handle: ({ id, data }) => updateAdminSegment(id, data),
    success: '保存成功',
    clientFail: '保存失败，请检查填写内容',
    serverFail: '服务器异常，保存失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员软删除材料 */
export const useDeleteAdminSegment = () => {
  const cfg = createResCfg<number, null>({
    handle: deleteAdminSegment,
    success: '删除成功',
    clientFail: '删除失败',
    serverFail: '服务器异常，删除失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 审核门禁：材料试听解锁（填理由→留痕→签名） */
export const useAuditionSegment = () => {
  const cfg = createResCfg<{ id: number; payload: AuditionPayload }, AuditionResult>({
    handle: ({ id, payload }) => auditionAdminSegment(id, payload),
    success: '',
    clientFail: '解锁失败，请检查填写内容',
    serverFail: '服务器异常，解锁失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 审核门禁：调整受限材料公开状态（填理由→留痕→变更） */
export const useUpdateSegmentVisibility = () => {
  const cfg = createResCfg<
    { id: number; payload: AdminSegmentVisibilityPayload },
    { isPublic: number }
  >({
    handle: ({ id, payload }) => updateSegmentVisibility(id, payload),
    success: '',
    clientFail: '调整失败，请检查填写内容',
    serverFail: '服务器异常，调整失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
