/** 管理员用户管理共享类型（列表 / 资料修改 / 封禁） */

/** 用户列表项（不含 passwordHash） */
export interface AdminUserListItem {
  id: number
  account: string
  nickname: string | null
  email: string | null
  role: number          // 0 普通用户 1 管理员
  level: number         // 0 未测试 1 初级 2 中级 3 高级
  status: number        // 0 封禁 1 正常
  deletedAt: string | null   // 销号（软删除）时间
  createdAt: string
}

/** 用户状态筛选枚举 */
export type AdminUserState = 'all' | 'normal' | 'banned' | 'deleted'

/** 用户列表查询参数（query string，后端 zod coerce） */
export interface AdminUserListQuery {
  page?: number
  pageSize?: number
  keyword?: string      // 按账号/昵称模糊搜索
  state?: AdminUserState
}

/** 用户列表响应（服务端分页） */
export interface AdminUserListResult {
  list: AdminUserListItem[]
  total: number
  page: number
  pageSize: number
}

/** 资料修改载荷（nickname / email / level；本次不含角色变更） */
export interface AdminUserUpdatePayload {
  nickname?: string | null
  email?: string | null
  level?: number        // 0-3
}

/** 封禁/解封载荷 */
export interface AdminUserStatusPayload {
  status: number        // 0 封禁 1 正常
}
