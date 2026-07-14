export interface LoginPayload {
    account: string
    password: string
}

export interface LoginResPayload {
    id: number
    nickname?: string
    role?: number
    account: string
    email?: string
    avatarUrl?: string
    level?: number
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
  totalStudyMinutes: number
}