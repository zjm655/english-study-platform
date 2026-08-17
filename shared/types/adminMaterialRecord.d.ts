import type { MaterialUploadStatus } from './material'

export type {
  AdminMaterialRecordListQuery,
  AdminMaterialRecordReprocessPayload,
} from '../schemas/adminMaterialRecord'

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
  /** NLS 语音识别转写文本（开启 NLS 且识别成功后写入；未开启/失败为 null） */
  nls_transcript?: string | null
}

/** 管理员上传记录列表响应 */
export interface AdminMaterialRecordListResult {
  list: AdminMaterialRecordListItem[]
  total: number
  page: number
  pageSize: number
}

/** 单个快照阶段（诊断页展示） */
export interface PipelineStageView {
  name: string
  ok: boolean
  detail?: Record<string, unknown> | null
  error?: string | null
}

/** 流水线快照（material_upload_record.pipeline_snapshot 解析后） */
export interface PipelineSnapshotView {
  stages: PipelineStageView[]
  failedAt?: string | null
  finalError?: string | null
}

/** 管理员上传记录诊断详情（诊断页数据） */
export interface AdminMaterialRecordDiag {
  id: number
  title: string
  status: MaterialUploadStatus
  source: 'user' | 'admin'
  nls_check: number
  text_content: string
  voice: string
  error_message: string | null
  nls_transcript: string | null
  speaker_annotated: string | null
  pipeline_snapshot: PipelineSnapshotView | null
  audioUrl?: string | null
  username: string
  createdAt: string
  updatedAt: string
  /** 成功时的学习产物（从 segment 取） */
  segment?: {
    translation: string | null
    questions: unknown | null
    vocabulary: Array<Record<string, unknown>>
  } | null
}
