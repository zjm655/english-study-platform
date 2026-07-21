/** 管理员用户管理共享类型（列表 / 资料修改 / 封禁） */

/** 用户列表项（不含 passwordHash） */
export interface AdminUserListItem {
  id: number
  account: string
  nickname: string | null
  email: string | null
  role: number // 0 普通用户 1 管理员
  level: number // 0 未测试 1 初级 2 中级 3 高级
  status: number // 0 封禁 1 正常
  deletedAt: string | null // 销号（软删除）时间
  createdAt: string
}

/** 用户状态筛选枚举 */
export type AdminUserState = 'all' | 'normal' | 'banned' | 'deleted'

/** 用户列表查询参数（query string，后端 zod coerce） */
export interface AdminUserListQuery {
  page?: number
  pageSize?: number
  keyword?: string // 按账号/昵称模糊搜索
  state?: AdminUserState
}

/** 用户列表响应（服务端分页） */
export interface AdminUserListResult {
  list: AdminUserListItem[]
  total: number
  page: number
  pageSize: number
}

/** 资料修改载荷（nickname / email / level；本次不含角色变更） */
export interface AdminUserUpdatePayload {
  nickname?: string | null
  email?: string | null
  level?: number // 0-3
}

/** 封禁/解封载荷 */
export interface AdminUserStatusPayload {
  status: number // 0 封禁 1 正常
}

// ============== 用户详情 ==============

/** 用户学习统计 */
export interface AdminUserLearningStats {
  totalSegmentsCompleted: number
  totalRecordings: number
  avgScore: number | null
  totalStudySeconds: number
  totalCheckinDays: number
  currentStreak: number
}

/** 用户 Unit 进度中的单个 Segment 进度 */
export interface AdminUserSegmentProgress {
  segmentId: number
  segmentTitle: string
  phase1Done: boolean
  phase2Done: boolean
  phase3Done: boolean
  phase4Done: boolean
  phase3Score: number | null
  phase4Score: number | null
}

/** 用户 Unit 进度 */
export interface AdminUserUnitProgress {
  unitId: number
  unitTitle: string
  segments: AdminUserSegmentProgress[]
}

/** 用户录音历史项（仅元数据，不含音频 URL / 识别内容） */
export interface AdminUserRecordingItem {
  id: number
  phase: number // 3 配音 / 4 跟读
  score: number | null
  duration: number | null // 秒
  segmentTitle: string
  createdAt: string
}

/** 用户详情 */
export interface AdminUserDetail {
  user: {
    id: number
    account: string
    nickname: string | null
    email: string | null
    role: number
    level: number
    status: number
    deletedAt: string | null
    createdAt: string
  }
  stats: AdminUserLearningStats
  unitProgress: AdminUserUnitProgress[]
  recentRecordings: AdminUserRecordingItem[]
}

// ============== 角色变更 ==============

/** 角色变更载荷 */
export interface AdminUserRolePayload {
  role: number // 0 普通用户 1 管理员
}
