/** 批量操作跳过项（含跳过原因，前端可展开明细） */
export type {
  AdminSegmentBatchPayload,
  AdminUnitBatchPayload,
  AdminMaterialRecordBatchPayload,
  AdminUserBatchPayload,
} from '../schemas/batch'

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
