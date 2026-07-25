/** 授权管理（超管专属）共享类型 */

/** 某用户的角色 + 已授予权限（授权管理页加载用） */
export interface AdminUserPermissionDetail {
  /** 目标用户当前角色 */
  role: number
  /** 目标用户已授予的权限键 */
  permissions: string[]
}

/** 覆盖式更新权限载荷 */
export interface AdminUserPermissionUpdatePayload {
  permissions: string[]
}

/** 审核门禁试听——填理由载荷 */
export interface AuditionPayload {
  reasonCategory: string
  reason: string
}

/** 审核门禁试听——解锁结果（签名 URL + 时长） */
export interface AuditionResult {
  audioUrl: string
  duration: number | null
}
