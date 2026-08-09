/** 管理员操作日志共享类型（全局查看 + 用户维度查看） */
export type { AdminOperationLogListQuery } from '../schemas/adminOperationLog'

/** 操作日志列表项 */
export interface AdminOperationLogItem {
  id: number
  adminAccount: string | null // LEFT JOIN user，管理员可能已删除
  action: string // user.ban / user.unban / user.delete / user.update / user.role.update / segment.update / segment.delete
  targetType: string // user / segment
  targetId: number
  detail: Record<string, unknown> | null // JSON 变更快照
  createdAt: string
}

/** 操作日志列表响应（服务端分页） */
export interface AdminOperationLogListResult {
  list: AdminOperationLogItem[]
  total: number
  page: number
  pageSize: number
}
