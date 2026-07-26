/** 批量操作跳过项（含跳过原因，前端可展开明细） */
export interface BatchSkippedItem {
  id: number
  reason: string
}

/**
 * 管理后台批量操作统一响应契约（部分成功语义，HTTP 恒 200）：
 * succeeded 为实际生效条数，skipped 为被护栏过滤/状态不符的条目明细。
 */
export interface BatchResult {
  succeeded: number
  skipped: BatchSkippedItem[]
}

/** 材料批量操作请求（delete=批量软删；move=批量修改所属单元） */
export type AdminSegmentBatchPayload =
  { action: 'delete'; ids: number[] } | { action: 'move'; ids: number[]; unitId: number }

/** 单元批量操作请求（仅批量软删） */
export interface AdminUnitBatchPayload {
  action: 'delete'
  ids: number[]
}

/** 上传记录批量操作请求（delete=批量删除；reprocess=批量重试，ids ≤20） */
export type AdminMaterialRecordBatchPayload =
  { action: 'delete'; ids: number[] } | { action: 'reprocess'; ids: number[]; unitId: number }

/** 用户批量操作请求（ban=封禁 / unban=解封 / delete=销号） */
export interface AdminUserBatchPayload {
  action: 'ban' | 'unban' | 'delete'
  ids: number[]
}
