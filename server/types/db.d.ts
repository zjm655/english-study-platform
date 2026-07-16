// 数据库行类型（对应 MySQL 查询结果）

export interface UserRow {
  id: number
  account: string
  nickname: string | null
  email: string | null
  role: number
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
  coverUrl: string | null      // 旧字段，待删除
  cover_media_id: number | null
  level: number
  sort_order: number
  createdAt: string
}

export interface SegmentRow {
  id: number
  unit_id: number
  title: string
  audioUrl: string | null      // 旧字段，待删除
  duration: string | null      // 旧字段，待删除
  media_id: number | null
  textContent: string
  translation: string | null
  questions: string | null     // JSON string
  sort_order: number
  createdAt: string
}

export interface UserProgressRow {
  id: number
  user_id: number
  segment_id: number
  phase1_done: number          // 0 or 1
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
  audioPath: string | null    // 旧字段，待删除
  media_id: number | null
  score: string | null        // DECIMAL → string
  feedback: string | null
  recognizedText: string | null
  wordScores: string | null   // JSON string
  duration: string | null     // DECIMAL → string
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
  audioUrl: string | null      // 旧字段，待删除
  duration: string | null      // 旧字段，待删除
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
  audioUrl: string | null      // 旧字段，待删除
  duration: string | null      // 旧字段，待删除
  media_id: number | null
  level: number
  source: string | null
  frequency: number
  tags: string | null
  createdAt: string
}