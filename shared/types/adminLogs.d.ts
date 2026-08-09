/** 统一日志管理共享类型（三子页） */
export type {
  ApiCallLogListQuery,
  CloudServiceLogListQuery,
  OperationLogListQueryV2,
  ReviewAccessLogListQuery,
} from '../schemas/adminLogs'

/** API 调用日志列表项（对应 api_call_log 表） */
export interface ApiCallLogItem {
  id: number
  path: string
  routePattern: string | null
  method: string
  statusCode: number
  durationMs: number
  userId: number | null
  ip: string | null
  requestId: string | null
  errorMessage: string | null
  errorStack: string | null
  createdAt: string
}

/** 云服务调用日志列表项（对应 cloud_service_call_log 表） */
export interface CloudServiceLogItem {
  id: number
  service: string
  operation: string
  success: number // 0/1
  durationMs: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  errorMessage: string | null
  createdAt: string
}

/** 通用分页列表响应（三子页共用） */
export interface LogListResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 审核留痕列表项（对应 review_access_log 表 + 双 LEFT JOIN user 联表字段） */
export interface ReviewAccessLogItem {
  id: number
  operatorId: number | null // 账号删除后为 null，前端显「已删除」
  operatorAccount: string | null
  operatorRole: number // 角色快照 0用户 1管理员 2超管
  targetType: string // 见 REVIEW_TARGET_TYPES
  targetId: number
  targetUserId: number | null
  targetUserAccount: string | null
  reasonCategory: string
  reason: string
  ip: string | null
  createdAt: string
}

/** 三子页各自的响应类型别名 */
export type ApiCallLogListResult = LogListResult<ApiCallLogItem>
export type CloudServiceLogListResult = LogListResult<CloudServiceLogItem>
export type ReviewAccessLogListResult = LogListResult<ReviewAccessLogItem>
// 操作日志复用现有 AdminOperationLogListResult（来自 adminOperationLog.d.ts）

/** 单张归档表统计（GET /api/admin/logs/archive-stats） */
export interface LogArchiveStatsItem {
  table: string // 原表名（api_call_log / cloud_service_call_log / admin_operation_log）
  rows: number // 归档表行数
  oldest: string | null // 归档中最早的原始日志时间
  newest: string | null // 归档中最晚的原始日志时间
}

/** 归档统计响应 */
export interface LogArchiveStatsResult {
  items: LogArchiveStatsItem[]
}
