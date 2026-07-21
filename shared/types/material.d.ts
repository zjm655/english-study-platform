/** 上传材料响应 */
export interface UploadMaterialResult {
  segmentId: number
  title: string
}

/** 材料上传记录 */
export interface MaterialUploadRecord {
  id: number
  user_id: number
  title: string
  text_content: string
  voice: string
  is_public: number
  status: 'processing' | 'success' | 'failed'
  error_message: string | null
  segment_id: number | null
  createdAt: string
  updatedAt: string
}

/** 材料上传记录列表项（前端展示用，精简字段） */
export interface MaterialUploadRecordListItem {
  id: number
  title: string
  status: 'processing' | 'success' | 'failed'
  error_message: string | null
  segment_id: number | null
  is_public: number
  createdAt: string
}

/** 更新材料记录参数 */
export interface UpdateMaterialRecordPayload {
  isPublic: number
}
