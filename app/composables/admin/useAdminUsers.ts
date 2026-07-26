import {
  getAdminUserList,
  updateAdminUser,
  updateAdminUserStatus,
  deleteAdminUser,
  getAdminUserDetail,
  updateAdminUserRole,
  getAdminUserLogs,
  getAdminUserPermissions,
  updateAdminUserPermissions,
  getAdminUserRecordings,
  auditionUserRecording,
  batchAdminUsers,
} from '~/api/admin/user'
import type {
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserUpdatePayload,
  AdminUserDetail,
  AdminUserRecordingListQuery,
  AdminUserRecordingListResult,
  AdminRecordingDetailResult,
} from '#shared/types/adminUser'
import type { AdminUserPermissionDetail, AuditionPayload } from '#shared/types/adminPermission'
import type {
  AdminOperationLogListQuery,
  AdminOperationLogListResult,
} from '#shared/types/adminOperationLog'
import type { AdminUserBatchPayload, BatchResult } from '#shared/types/adminBatch'

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

/** 管理员批量操作用户（ban/unban/delete；成功文案由页面按 BatchResult 汇总） */
export const useBatchAdminUsers = () => {
  const cfg = createResCfg<AdminUserBatchPayload, BatchResult>({
    handle: batchAdminUsers,
    success: '',
    clientFail: '批量操作失败，请检查选中项',
    serverFail: '服务器异常，批量操作失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员查看用户详情 */
export const useAdminUserDetail = () => {
  const cfg = createResCfg<number, AdminUserDetail>({
    handle: getAdminUserDetail,
    success: '',
    clientFail: '获取用户详情失败',
    serverFail: '服务器异常，获取详情失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员变更用户角色 */
export const useUpdateAdminUserRole = () => {
  const cfg = createResCfg<{ id: number; role: number }, null>({
    handle: ({ id, role }) => updateAdminUserRole(id, role),
    success: '角色变更成功',
    clientFail: '角色变更失败',
    serverFail: '服务器异常，角色变更失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员查看用户操作日志 */
export const useAdminUserLogs = () => {
  const cfg = createResCfg<
    { id: number; query: AdminOperationLogListQuery },
    AdminOperationLogListResult
  >({
    handle: ({ id, query }) => getAdminUserLogs(id, query),
    success: '',
    clientFail: '获取操作日志失败',
    serverFail: '服务器异常，获取日志失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 获取某用户的角色 + 已授予权限（超管专属授权页） */
export const useAdminUserPermissions = () => {
  const cfg = createResCfg<number, AdminUserPermissionDetail>({
    handle: getAdminUserPermissions,
    success: '',
    clientFail: '获取用户权限失败',
    serverFail: '服务器异常，获取权限失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 覆盖式设置某用户权限（超管专属） */
export const useUpdateAdminUserPermissions = () => {
  const cfg = createResCfg<{ id: number; permissions: string[] }, null>({
    handle: ({ id, permissions }) => updateAdminUserPermissions(id, permissions),
    success: '权限已更新',
    clientFail: '权限更新失败',
    serverFail: '服务器异常，权限更新失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 管理员查看某用户录音记录列表（分页 + 筛选） */
export const useAdminUserRecordingList = () => {
  const cfg = createResCfg<
    { id: number; query: AdminUserRecordingListQuery },
    AdminUserRecordingListResult
  >({
    handle: ({ id, query }) => getAdminUserRecordings(id, query),
    success: '',
    clientFail: '获取录音记录失败',
    serverFail: '服务器异常，获取录音记录失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 审核门禁：查看某用户录音评测详情（填理由 + 留痕成功后返回） */
export const useAuditionUserRecording = () => {
  const cfg = createResCfg<
    { id: number; recordingId: number; payload: AuditionPayload },
    AdminRecordingDetailResult
  >({
    handle: ({ id, recordingId, payload }) => auditionUserRecording(id, recordingId, payload),
    success: '',
    clientFail: '查看失败，请检查填写内容',
    serverFail: '服务器异常，查看失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
