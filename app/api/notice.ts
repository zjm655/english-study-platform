import { noticeListPath, noticeUnreadCountPath, noticeReadAllPath } from '~/api/paths'
import type { NoticeListResult, NoticeDetail } from '#shared/types/notice'

/** 用户端公告列表（仅活跃公告，服务端分页 + 置顶优先，附带 isRead） */
export const getNoticeList = (page?: number, pageSize?: number) => {
  return request.json<NoticeListResult>(`${noticeListPath}${buildQuery({ page, pageSize })}`)
}

/** 用户端公告详情（后端命中即自动标记已读，非活跃公告返回 404） */
export const getNoticeDetail = (id: number) => {
  return request.json<NoticeDetail>(`${noticeListPath}/${id}`)
}

/** 用户端未读公告数（首页铃铛红点） */
export const getUnreadCount = () => {
  return request.json<{ unreadCount: number }>(noticeUnreadCountPath)
}

/** 用户端一键已读（把全部活跃公告标记为已读） */
export const readAllNotices = () => {
  return request.json<{ affectedRows: number }>(noticeReadAllPath, {
    method: 'POST',
  })
}
