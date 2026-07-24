export interface LoginPayload {
  account: string
  password: string
  /** 图形验证码 token（登录连错达阈值后必填） */
  captchaToken?: string
  /** 图形验证码用户输入（登录连错达阈值后必填） */
  captchaCode?: string
}

/** 图形验证码获取结果 */
export interface CaptchaResult {
  svg: string
  token: string
}

export interface LoginResPayload {
  id: number
  nickname: string | null
  role: number
  account: string
  email: string | null
  avatarUrl: string | null
  level: number
  /** 权限键集合（verify 下发，供前端展示控制；超管为全量）。防御式读取 permissions ?? [] */
  permissions?: string[]
}

export interface RegisterPayload {
  nickname?: string
  account: string
  email?: string
  password1: string
  password2: string
  /** 图形验证码 token（注册必填） */
  captchaToken: string
  /** 图形验证码用户输入（注册必填） */
  captchaCode: string
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
