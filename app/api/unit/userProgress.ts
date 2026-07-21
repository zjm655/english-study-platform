import { userProgressPath } from '../paths'
import type { UserProgress } from '~~/shared/types/unit'

export const getUserProgress = async () => {
  return request<UserProgress>(userProgressPath, { method: 'GET' })
}

export interface UpdateProgressPayload {
  segmentId: number
  phase: 1 | 2 | 3 | 4
  done: boolean
  score?: number
}

export interface SegmentProgress {
  segmentId: number
  phase1_done: boolean
  phase2_done: boolean
  phase3_done: boolean
  phase3_score: number | null
  phase4_done: boolean
  phase4_score: number | null
  updatedAt: string
}

export const putUserProgress = async (payload: UpdateProgressPayload) => {
  return request<SegmentProgress>(userProgressPath, {
    method: 'PUT',
    body: payload,
  })
}
