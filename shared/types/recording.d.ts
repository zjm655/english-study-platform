/** 录音相关请求类型：analyze-fail 失败原因（P2-A，从 schema 推导，P3-H 补 re-export） */
export type { AnalyzeFailInput } from '../schemas/recording'

/** 逐词评分项 */
export interface WordScore {
  word: string
  score: number // 0-100
  status: 'correct' | 'minor' | 'wrong' | 'missing'
  phonetic?: string
}

/** 录音记录（前端使用） */
export interface Recording {
  id: number
  userId: number
  segmentId: number
  phase: number // 3=配音, 4=跟读
  audioPath: string | null
  score: number | null // 综合评分 0-100
  analyzeStatus: 'pending' | 'failed' | 'success' // 新增
  analyzeError: string | null // 评测失败原因（analyze-fail 结构化上报，P2-A）
  feedback: string | null // AI整体评价
  recognizedText: string | null
  wordScores: WordScore[] | null
  rawResult: string | null // SDK评测原始响应JSON
  duration: number | null // 秒
  createdAt: string
}

/** 上传录音请求参数 */
export interface UploadRecordingPayload {
  audioBlob: Blob
  segmentId: number
  phase: 3 | 4
  duration: number
}

/** 上传录音响应 */
export interface UploadRecordingResult {
  id: number
  audioPath: string
  duration: number
  createdAt: string
}

/** 录音列表查询参数 */
export interface RecordingListQuery {
  segmentId: number
  phase?: 3 | 4
  page?: number // 页码，默认 1
  pageSize?: number // 每页条数，默认 3
}

/** 分页包装 */
export interface PaginatedRecordings {
  items: Recording[]
  total: number
  page: number
  pageSize: number
}
