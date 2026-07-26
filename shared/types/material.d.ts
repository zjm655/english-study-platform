/** 上传材料响应（异步任务模式：秒回记录 ID，处理进度轮询上传记录） */
export interface UploadMaterialResult {
  recordId: number
  /** 入队时前方排队任务数 */
  queuePosition: number
}

/** 材料上传记录状态 */
export type MaterialUploadStatus = 'queued' | 'processing' | 'success' | 'failed'

/** 材料上传记录 */
export interface MaterialUploadRecord {
  id: number
  user_id: number
  title: string
  text_content: string
  voice: string
  is_public: number
  status: MaterialUploadStatus
  error_message: string | null
  segment_id: number | null
  createdAt: string
  updatedAt: string
}

/** 材料上传记录列表项（前端展示用，精简字段） */
export interface MaterialUploadRecordListItem {
  id: number
  title: string
  status: MaterialUploadStatus
  error_message: string | null
  segment_id: number | null
  is_public: number
  createdAt: string
  /** 仅 status='queued' 时返回：前方排队任务数 */
  queuedAhead?: number
}

/** 材料上传任务状态项（批量状态轮询轻接口返回） */
export interface MaterialRecordStatusItem {
  id: number
  status: MaterialUploadStatus
  error_message: string | null
  segment_id: number | null
  title: string
  /** 仅 status='queued' 时返回：前方排队任务数 */
  queuedAhead?: number
}

/** 更新材料记录参数 */
export interface UpdateMaterialRecordPayload {
  isPublic: number
}
