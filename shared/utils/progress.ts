// shared/utils/progress.ts
// Phase 进度映射公共工具 — 消除 4 个端点中重复的进度字段映射逻辑

/** 统一的 Phase 进度结构 */
export interface PhaseProgress {
  phase1_done: boolean
  phase2_done: boolean
  phase3_done: boolean
  phase3_score: number | null
  phase4_done: boolean
  phase4_score: number | null
  updatedAt?: string | Date | null
}

/** 默认空进度（所有阶段未完成） */
export const DEFAULT_PROGRESS: PhaseProgress = {
  phase1_done: false,
  phase2_done: false,
  phase3_done: false,
  phase3_score: null,
  phase4_done: false,
  phase4_score: null,
}

/**
 * 将数据库行（含 phase1_done/phase2_done/... 等字段）映射为 PhaseProgress
 * 兼容 mysql2 返回的 0/1 数字和 boolean 两种格式
 */
export function mapProgressRow(row: {
  phase1_done?: number | boolean | null
  phase2_done?: number | boolean | null
  phase3_done?: number | boolean | null
  phase3_score?: number | string | null
  phase4_done?: number | boolean | null
  phase4_score?: number | string | null
  updatedAt?: string | Date | null
}): PhaseProgress {
  return {
    phase1_done: !!row.phase1_done,
    phase2_done: !!row.phase2_done,
    phase3_done: !!row.phase3_done,
    phase3_score: row.phase3_score ? Number(row.phase3_score) : null,
    phase4_done: !!row.phase4_done,
    phase4_score: row.phase4_score ? Number(row.phase4_score) : null,
    updatedAt: row.updatedAt ?? null,
  }
}