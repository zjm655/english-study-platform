export interface LoginPayload {
  account: string
  password: string
}

export interface LoginResPayload {
  id: number
  nickname: string | null
  role: number
  account: string
  email: string | null
  avatarUrl: string | null
  level: number
}

export interface RegisterPayload {
  nickname?: string
  account: string
  email?: string
  password1: string
  password2: string
}

export interface CheckinStats {
  totalCheckinDays: number
  lastCheckinTime: string | null
  currentStreakDays: number
  maxStreakDays: number
  totalStudySeconds: number
}

/** 用户学习统计 */
export interface UserStats {
  completedSegments: number
  avgDubbingScore: number | null
  lastStudyTime: string | null
}
