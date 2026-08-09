// 请求参数类型从 zod schema 推导（单一真相源在 shared/schemas/user.ts）。
// 响应类型（CaptchaResult/LoginResPayload 等）无 schema 对应，保留手写。
export type {
  LoginPayload,
  RegisterPayload,
  UserProfileUpdatePayload,
  PasswordChangePayload,
  StudyTimePayload,
} from '../schemas/user'

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

export interface CheckinStats {
  totalCheckinDays: number
  lastCheckinTime: string | null
  currentStreakDays: number
  maxStreakDays: number
  totalStudySeconds: number
}

/** 游客学习时长上报结果（GUEST：PUT /api/guest/study-time） */
export interface GuestStudyResult {
  /** 展示用短 ID（guestKey 前 8 位），前端写 localStorage 仅作展示冗余 */
  guestDisplayId: string
  /** 已实体化并累计时返回最新统计；未落库（首访/0 秒基准/残留 cookie）为 null */
  stats: CheckinStats | null
}

/** 头像上传结果 */
export interface AvatarUploadResult {
  avatarUrl: string
}

/** 用户学习统计 */
export interface UserStats {
  completedSegments: number
  avgDubbingScore: number | null
  lastStudyTime: string | null
}
