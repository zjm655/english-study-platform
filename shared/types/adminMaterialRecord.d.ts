import type { MaterialUploadStatus } from './material'

/** 上传来源筛选 */
export type UploadSource = 'all' | 'user' | 'admin'

/** 管理员材料上传记录列表项 */
export interface AdminMaterialRecordListItem {
  id: number
  title: string
  status: MaterialUploadStatus
  error_message: string | null
  segment_id: number | null
  is_public: number
  /** 是否开启 NLS 语音校对: 0关闭 1开启（管理员上传音频时可选，重处理沿用） */
  nls_check: number
  username: string
  /** 上传者用户 ID（用户行已物理删除时为 null，前端降级纯文本） */
  userId: number | null
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
  /** 是否开启 NLS 语音校对: 0关闭 1开启 */
  nls_check: number
  status: MaterialUploadStatus
  error_message: string | null
  segment_id: number | null
  username: string
  source: 'user' | 'admin'
  createdAt: string
  updatedAt: string
  /** 试听音频签名 URL（仅管理员上传/公开材料返回；非公开用户材料为 null） */
  audioUrl?: string | null
  /** 音频时长（秒） */
  duration?: number | null
}

/** 管理员上传记录列表查询参数 */
export interface AdminMaterialRecordListQuery {
  page?: number
  pageSize?: number
  status?: MaterialUploadStatus
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
