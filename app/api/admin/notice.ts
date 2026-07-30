import { adminNoticePath } from '../paths'
import type {
  AdminNoticeListResult,
  NoticeCreatePayload,
  NoticeUpdatePayload,
  NoticeStatus,
} from '#shared/types/notice'

/** 管理端公告列表查询参数（status 传 'all' 或缺省时不过滤状态） */
export interface AdminNoticeListQuery {
  page?: number
  pageSize?: number
  status?: NoticeStatus | 'all'
  keyword?: string
}

/** 管理端公告列表（全部状态 + 标题搜索，附创建者昵称与阅读数） */
export const getAdminNoticeList = (options: AdminNoticeListQuery = {}) => {
  return request.json<AdminNoticeListResult>(
    `${adminNoticePath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      status: options.status,
      keyword: options.keyword,
    })}`,
  )
}

/** 管理端创建公告（status 仅 draft/published；发布态未传 publishAt 后端取当前时间） */
export const createAdminNotice = (payload: NoticeCreatePayload) => {
  return request.json<{ id: number }>(adminNoticePath, {
    method: 'POST',
    body: payload,
  })
}

/** 管理端更新公告（受状态转移规则约束：已发布仅可改 expireAt/isPinned/转 revoked） */
export const updateAdminNotice = (id: number, payload: NoticeUpdatePayload) => {
  return request.json<null>(`${adminNoticePath}/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

/** 管理端删除公告 */
export const deleteAdminNotice = (id: number) => {
  return request.json<null>(`${adminNoticePath}/${id}`, {
    method: 'DELETE',
  })
}
