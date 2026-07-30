/** 系统公告共享类型（用户端消息中心 / 管理端公告管理） */

/** 公告状态：草稿 / 已发布 / 已撤回（定时发布 = published + 未来 publishAt，无独立 scheduled 态） */
export type NoticeStatus = 'draft' | 'published' | 'revoked'

/** 公告基础字段（用户端可见字段，不含管理内部字段） */
export interface Notice {
  id: number
  title: string
  content: string
  status: NoticeStatus
  publishAt: string
  expireAt: string | null // null = 永不过期
  isPinned: boolean
  createdAt: string
}

/** 用户端公告列表项（附带当前用户是否已读） */
export interface NoticeListItem extends Notice {
  isRead: boolean
}

/** 用户端公告列表响应（服务端分页） */
export interface NoticeListResult {
  list: NoticeListItem[]
  total: number
  page: number
  pageSize: number
}

/** 公告详情（用户端，附带创建者昵称，仅管理场景需要时填充） */
export interface NoticeDetail extends Notice {
  createdByName?: string
}

/** 公告创建载荷（管理端） */
export interface NoticeCreatePayload {
  title: string
  content: string
  publishAt?: string | null // 缺省时发布态取 NOW
  expireAt?: string | null
  isPinned?: boolean
  status?: Extract<NoticeStatus, 'draft' | 'published'> // 创建仅允许 draft/published
}

/** 公告更新载荷（管理端，全字段可选，受状态转移规则约束） */
export interface NoticeUpdatePayload {
  title?: string
  content?: string
  publishAt?: string | null
  expireAt?: string | null
  isPinned?: boolean
  status?: NoticeStatus // 更新可含 revoked
}

/** 管理端公告列表项（附带阅读数与创建者昵称） */
export interface AdminNoticeListItem extends Notice {
  readCount: number
  createdByName: string | null
}

/** 管理端公告列表响应（服务端分页） */
export interface AdminNoticeListResult {
  list: AdminNoticeListItem[]
  total: number
  page: number
  pageSize: number
}
