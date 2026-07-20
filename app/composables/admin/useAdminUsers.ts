import {
  getAdminUserList,
  updateAdminUser,
  updateAdminUserStatus,
  deleteAdminUser,
} from '~/api/admin/user'
import type {
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserUpdatePayload,
} from '#shared/types/adminUser'

/** 管理员用户列表（服务端分页 + 搜索 + 状态筛选） */
export const useAdminUserList = () => {
  const cfg = createResCfg<AdminUserListQuery, AdminUserListResult>({
    handle: getAdminUserList,
    success: '获取用户列表成功',
    clientFail: '获取用户列表失败',
    serverFail: '服务器异常，获取列表失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员修改用户资料（nickname / email / level） */
export const useUpdateAdminUser = () => {
  const cfg = createResCfg<{ id: number; data: AdminUserUpdatePayload }, null>({
    handle: ({ id, data }) => updateAdminUser(id, data),
    success: '修改成功',
    clientFail: '修改失败，请检查填写内容',
    serverFail: '服务器异常，修改失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员封禁/解封用户 */
export const useUpdateAdminUserStatus = () => {
  const cfg = createResCfg<{ id: number; status: number }, null>({
    handle: ({ id, status }) => updateAdminUserStatus(id, status),
    success: '操作成功',
    clientFail: '操作失败',
    serverFail: '服务器异常，操作失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员销号（软删除） */
export const useDeleteAdminUser = () => {
  const cfg = createResCfg<number, null>({
    handle: deleteAdminUser,
    success: '销号成功',
    clientFail: '销号失败',
    serverFail: '服务器异常，销号失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
