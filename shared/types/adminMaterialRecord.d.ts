/** 上传来源筛选 */
export type UploadSource = 'all' | 'user' | 'admin'

/** 管理员材料上传记录列表项 */
export interface AdminMaterialRecordListItem {
  id: number
  title: string
  status: 'processing' | 'success' | 'failed'
  error_message: string | null
  segment_id: number | null
  is_public: number
  username: string
  source: 'user' | 'admin'
  createdAt: string
}

/** 管理员材料上传记录详情 */
export interface AdminMaterialRecordDetail {
  id: number
  user_id: number
  title: string
  text_content: string
  voice: string
  is_public: number
  status: 'processing' | 'success' | 'failed'
  error_message: string | null
  segment_id: number | null
  username: string
  source: 'user' | 'admin'
  createdAt: string
  updatedAt: string
}

/** 管理员上传记录列表查询参数 */
export interface AdminMaterialRecordListQuery {
  page?: number
  pageSize?: number
  status?: 'processing' | 'success' | 'failed'
  source?: UploadSource
  startDate?: string
  endDate?: string
}

/** 管理员上传记录列表响应 */
export interface AdminMaterialRecordListResult {
  list: AdminMaterialRecordListItem[]
  total: number
  page: number
  pageSize: number
}

/** 重处理请求参数 */
export interface AdminMaterialRecordReprocessPayload {
  unitId: number
}