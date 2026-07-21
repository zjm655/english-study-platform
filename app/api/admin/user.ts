import { adminUserPath } from '../paths'
import type {
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserUpdatePayload,
} from '#shared/types/adminUser'

/**
 * 管理员用户列表（服务端分页 + 搜索 + 状态筛选）。
 * query 参数手动拼接 URLSearchParams；仅在有值时附加。
 */
export const getAdminUserList = (options: AdminUserListQuery = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined && options.page !== null)
    params.append('page', String(options.page))
  if (options.pageSize !== undefined && options.pageSize !== null)
    params.append('pageSize', String(options.pageSize))
  if (options.keyword) params.append('keyword', options.keyword)
  if (options.state) params.append('state', options.state)
  const query = params.toString()
  return request.json<AdminUserListResult>(`${adminUserPath}${query ? '?' + query : ''}`)
}

/** 管理员修改用户资料（nickname / email / level） */
export const updateAdminUser = (id: number, payload: AdminUserUpdatePayload) => {
  return request.json<null>(`${adminUserPath}/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

/** 管理员封禁/解封用户（status: 0封禁 1正常） */
export const updateAdminUserStatus = (id: number, status: number) => {
  return request.json<null>(`${adminUserPath}/${id}/status`, {
    method: 'PUT',
    body: { status },
  })
}

/** 管理员销号（软删除） */
export const deleteAdminUser = (id: number) => {
  return request.json<null>(`${adminUserPath}/${id}`, {
    method: 'DELETE',
  })
}
