// 数据库行类型（对应 MySQL 查询结果）

export interface UnitRow {
  id: number
  title: string
  description: string | null
  coverUrl: string | null
  level: number
  sort_order: number
  createdAt: string
}

export interface SegmentRow {
  id: number
  unit_id: number
  title: string
  audioUrl: string | null
  textContent: string
  translation: string | null
  questions: string | null // JSON string
  sort_order: number
  createdAt: string
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
