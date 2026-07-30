import {
  getAdminNoticeList,
  createAdminNotice,
  updateAdminNotice,
  deleteAdminNotice,
} from '~/api/admin/notice'
import type { AdminNoticeListQuery } from '~/api/admin/notice'
import type {
  AdminNoticeListResult,
  NoticeCreatePayload,
  NoticeUpdatePayload,
} from '#shared/types/notice'

/** 管理端公告列表（服务端分页 + 状态筛选 + 标题搜索；读静默） */
export const useAdminNoticeList = () => {
  const cfg = createResCfg<AdminNoticeListQuery, AdminNoticeListResult>({
    handle: getAdminNoticeList,
    success: '获取公告列表成功',
    clientFail: '获取公告列表失败',
    serverFail: '服务器异常，获取列表失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理端创建公告（写弹：存草稿/发布共用，失败文案回退后端 message） */
export const useCreateAdminNotice = () => {
  const cfg = createResCfg<NoticeCreatePayload, { id: number }>({
    handle: createAdminNotice,
    success: '',
    clientFail: '',
    serverFail: '服务器异常，创建失败',
    error: '网络异常，请检查网络',
    notify: 'all',
  })
  return useHandleRes(cfg)
}

/** 管理端更新公告（写弹：状态转移违规等 400 文案由后端给出） */
export const useUpdateAdminNotice = () => {
  const cfg = createResCfg<{ id: number; data: NoticeUpdatePayload }, null>({
    handle: ({ id, data }) => updateAdminNotice(id, data),
    success: '',
    clientFail: '',
    serverFail: '服务器异常，保存失败',
    error: '网络异常，请检查网络',
    notify: 'all',
  })
  return useHandleRes(cfg)
}

/** 管理端删除公告（写弹） */
export const useDeleteAdminNotice = () => {
  const cfg = createResCfg<number, null>({
    handle: deleteAdminNotice,
    success: '删除成功',
    clientFail: '删除失败',
    serverFail: '服务器异常，删除失败',
    error: '网络异常，请检查网络',
    notify: 'all',
  })
  return useHandleRes(cfg)
}
