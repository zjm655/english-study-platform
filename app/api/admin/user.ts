import { adminUserPath, adminUserBatchPath } from '~/api/paths'
import type {
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserUpdatePayload,
  AdminUserDetail,
  AdminUserRolePayload,
  AdminUserRecordingListQuery,
  AdminUserRecordingListResult,
  AdminRecordingDetailResult,
} from '#shared/types/adminUser'
import type {
  AdminOperationLogListResult,
  AdminOperationLogListQuery,
} from '#shared/types/adminOperationLog'
import type { AdminUserPermissionDetail, AuditionPayload } from '#shared/types/adminPermission'
import type { AdminUserBatchPayload, BatchResult } from '#shared/types/adminBatch'

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

/** 管理员批量操作用户（ban=批量封禁 / unban=批量解封 / delete=批量销号，部分成功语义） */
export const batchAdminUsers = (payload: AdminUserBatchPayload) => {
  return request.json<BatchResult>(adminUserBatchPath, {
    method: 'POST',
    body: payload,
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

/** 管理员查看某用户录音记录列表（分页 + 筛选） */
export const getAdminUserRecordings = (id: number, options: AdminUserRecordingListQuery = {}) => {
  return request.json<AdminUserRecordingListResult>(
    `${adminUserPath}/${id}/recordings${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      phase: options.phase,
      unitId: options.unitId,
      keyword: options.keyword,
      scoreBand: options.scoreBand,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )
}

/** 审核门禁：查看某用户录音评测详情（填理由 + 留痕成功后返回签名音频与识别文本） */
export const auditionUserRecording = (
  id: number,
  recordingId: number,
  payload: AuditionPayload,
) => {
  return request.json<AdminRecordingDetailResult>(
    `${adminUserPath}/${id}/recordings/${recordingId}`,
    { method: 'POST', body: payload },
  )
}
