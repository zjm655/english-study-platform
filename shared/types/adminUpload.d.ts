/** 管理员单个材料上传结果（单条） */
export interface AdminUploadItemResult {
  index: number
  success: boolean
  segmentId?: number
  title?: string
  error?: string
}

/** 管理员上传响应 */
export interface AdminUploadResponse {
  results: AdminUploadItemResult[]
  summary: { total: number, success: number, failed: number }
}