// 数据库行类型（对应 MySQL 查询结果）

import type { WordScore } from '#shared/types/recording'
import type { Question } from '#shared/types/unit'

export interface UserRow {
  id: number
  account: string
  nickname: string | null
  email: string | null
  role: number
  status: number // 0封禁 1正常
  deleted_at: string | null // 软删除时间(销号)
  passwordHash: string
  avatarUrl: string | null
  level: number
  createdAt: string
  updatedAt: string
}

export interface UnitRow {
  id: number
  title: string
  description: string | null
  cover_media_id: number | null
  level: number
  sort_order: number
  createdAt: string
}

export interface SegmentRow {
  id: number
  unit_id: number
  title: string
  media_id: number | null
  textContent: string
  translation: string | null
  questions: Question[] | string | null // json 列：mysql2 自动解析为数组，兼容字符串
  is_public: number // 0不公开 1公开
  sort_order: number
  createdAt: string
  deleted_at: string | null // 软删除时间（NULL 未删除）
}

export interface UserProgressRow {
  id: number
  user_id: number
  segment_id: number
  phase1_done: number // 0 or 1
  phase2_done: number
  phase3_done: number
  phase3_score: string | null // decimal as string
  phase4_done: number
  phase4_score: string | null
  updatedAt: string
  deleted_at: string | null
}

export interface ProgressDetailRow extends UserProgressRow {
  segmentTitle: string
  unit_id: number
  unitTitle: string
}

export interface CountRow {
  total: number
  completed: number
}

export interface CheckinStatsRow {
  user_id: number
  total_checkin_days: number
  last_checkin_time: string | null
  current_streak_days: number
  max_streak_days: number
  total_study_seconds: number
  updatedAt: string
}

export interface CheckinLogRow {
  id: number
  user_id: number
  checkin_date: string
  checked_in: number
  study_seconds: number
  segments_completed: number
  createdAt: string
  updatedAt: string
}

export interface RecordingRow {
  id: number
  user_id: number
  segment_id: number
  phase: number
  media_id: number | null
  score: string | null // DECIMAL → string
  feedback: string | null
  recognizedText: string | null
  wordScores: WordScore[] | string | null // json 列：mysql2 自动解析为数组，兼容字符串
  rawResult: string | null // 原始评测响应JSON
  duration: string | null // DECIMAL → string
  analyze_status: string // pending | success | failed
  createdAt: string
  deleted_at: string | null
}

export interface VocabularyRow {
  id: number
  segment_id: number
  word: string
  forms: string | null
  phonetic: string | null
  meaning: string
  exampleSentence: string | null
  exampleTranslation: string | null
  media_id: number | null
  sort_order: number
  createdAt: string
}

export interface WordBankRow {
  id: number
  word: string
  phonetic: string | null
  meaning: string
  forms: string | null
  exampleSentence: string | null
  exampleTranslation: string | null
  media_id: number | null
  level: number
  source: string | null
  frequency: number
  tags: string | null
  createdAt: string
}

export interface MaterialUploadRecordRow {
  id: number
  user_id: number
  title: string
  text_content: string
  voice: string
  is_public: number
  status: string
  error_message: string | null
  segment_id: number | null
  createdAt: string
  updatedAt: string
}

export interface AdminOperationLogRow {
  id: number
  admin_id: number | null // 账号删除后为 NULL
  action: string // user.ban/user.unban/user.delete/user.update/segment.update/segment.delete
  target_type: string // user/segment
  target_id: number
  detail: Record<string, unknown> | string | null // json 列
  createdAt: string
}
