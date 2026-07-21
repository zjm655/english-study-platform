/** 单元进度摘要（列表页用） */
export interface UnitProgressSummary {
  totalSegments: number
  completedSegments: number
  percent: number
}

/** 单元（含进度） */
export interface UnitWithProgress {
  id: number
  title: string
  description: string | null
  level: number
  sortOrder: number
  audioUrl: string | null
  progress: UnitProgressSummary
}

/** 片段阶段进度 */
export interface SegmentPhaseProgress {
  phase1_done: boolean
  phase2_done: boolean
  phase3_done: boolean
  phase3_score: number | null
  phase4_done: boolean
  phase4_score: number | null
  updatedAt?: string | null
}

/** 单元详情进度（含片段列表） */
export interface UnitProgressDetail {
  unit: {
    id: number
    title: string
    description: string | null
    level: number
    sortOrder: number
    audioUrl: string | null
  }
  segments: {
    id: number
    title: string
    audioUrl: string | null
    sortOrder: number
    isMine: boolean
    progress: SegmentPhaseProgress
  }[]
  pagination: {
    page: number
    pageSize: number
    total: number
    hasMore: boolean
  }
}

/** 用户整体进度 */
export interface UserProgress {
  summary: {
    totalSegmentsAll: number
    progressRecords: number
    completedSegments: number
    completedPhases: { phase1: number; phase2: number; phase3: number; phase4: number }
    overallPercent: number
  }
  details: {
    segmentId: number
    segmentTitle: string
    unitId: number
    unitTitle: string
    phase1_done: boolean
    phase2_done: boolean
    phase3_done: boolean
    phase3_score: number | null
    phase4_done: boolean
    phase4_score: number | null
    updatedAt: string | null
  }[]
}

/** 重点词信息 */
export interface VocabularyItem {
  id: number
  word: string
  forms: string | null
  phonetic: string | null
  meaning: string
  audioUrl: string | null
  duration: number | null
}

/** 理解题 */
export interface Question {
  question: string
  options: string[]
  answer: string
}

/** 片段详情（学习页用） */
export interface SegmentDetail {
  id: number
  title: string
  audioUrl: string | null
  duration: number | null
  textContent: string
  translation: string | null
  questions: Question[] | string | null
  unitId: number
  unitTitle: string
  vocabulary: VocabularyItem[]
  progress: SegmentPhaseProgress
}
