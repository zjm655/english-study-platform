/** 管理员单个材料上传结果（异步入队回执：success=已入队，实际处理结果轮询上传记录） */
export interface AdminUploadItemResult {
  index: number
  success: boolean
  /** 已入队时的上传记录 ID（去记录页追踪进度） */
  recordId?: number
  segmentId?: number
  title?: string
  error?: string
}

/** 管理员上传响应 */
export interface AdminUploadResponse {
  results: AdminUploadItemResult[]
  summary: { total: number; success: number; failed: number }
}
