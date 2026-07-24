import { adminUserPath } from '../paths'
import type {
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserUpdatePayload,
  AdminUserDetail,
  AdminUserRolePayload,
} from '#shared/types/adminUser'
import type {
  AdminOperationLogListResult,
  AdminOperationLogListQuery,
} from '#shared/types/adminOperationLog'
import type { AdminUserPermissionDetail } from '#shared/types/adminPermission'

/**
 * 管理员用户列表（服务端分页 + 搜索 + 状态筛选）。
 */
export const getAdminUserList = (options: AdminUserListQuery = {}) => {
  return request.json<AdminUserListResult>(
    `${adminUserPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      keyword: options.keyword,
      state: options.state,
    })}`,
  )
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

/** 管理员查看用户详情 */
export const getAdminUserDetail = (id: number) => {
  return request.json<AdminUserDetail>(`${adminUserPath}/${id}/detail`)
}

/** 管理员变更用户角色（提升/降权） */
export const updateAdminUserRole = (id: number, role: number) => {
  return request.json<null>(`${adminUserPath}/${id}/role`, {
    method: 'PUT',
    body: { role } satisfies AdminUserRolePayload,
  })
}

/** 管理员查看用户操作日志 */
export const getAdminUserLogs = (id: number, options: AdminOperationLogListQuery = {}) => {
  return request.json<AdminOperationLogListResult>(
    `${adminUserPath}/${id}/logs${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
    })}`,
  )
}

/** 获取某用户的角色 + 已授予权限（授权管理，超管专属） */
export const getAdminUserPermissions = (id: number) => {
  return request.json<AdminUserPermissionDetail>(`${adminUserPath}/${id}/permissions`)
}

/** 覆盖式设置某用户权限（超管专属） */
export const updateAdminUserPermissions = (id: number, permissions: string[]) => {
  return request.json<null>(`${adminUserPath}/${id}/permissions`, {
    method: 'PUT',
    body: { permissions },
  })
}
