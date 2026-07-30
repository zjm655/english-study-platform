import { getNoticeList, getNoticeDetail } from '~/api/notice'
import type { NoticeListResult, NoticeDetail } from '#shared/types/notice'

/** 用户端公告列表查询参数 */
export interface NoticeListQuery {
  page?: number
  pageSize?: number
}

/** 用户端公告列表（读静默：失败不弹 toast，仅控制台日志） */
export const useNoticeList = () => {
  const cfg = createResCfg<NoticeListQuery, NoticeListResult>({
    handle: ({ page, pageSize }) => getNoticeList(page, pageSize),
    success: '获取公告列表成功',
    clientFail: '获取公告列表失败',
    serverFail: '服务器异常，获取列表失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 用户端公告详情（读静默；后端命中即自动标记已读，404 由页面空态承接） */
export const useNoticeDetail = () => {
  const cfg = createResCfg<number, NoticeDetail>({
    handle: getNoticeDetail,
    success: '获取公告详情成功',
    clientFail: '获取公告详情失败',
    serverFail: '服务器异常，获取详情失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
