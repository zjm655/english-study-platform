/** 统一日志管理共享类型（三子页） */

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
  createdAt: string
}

/** API 调用日志列表查询参数 */
export interface ApiCallLogListQuery {
  page?: number
  pageSize?: number
  method?: string
  statusCodeGroup?: 'success' | '4xx' | '5xx'
  pathKeyword?: string
  userId?: number
  startDate?: string
  endDate?: string
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

/** 云服务调用日志列表查询参数 */
export interface CloudServiceLogListQuery {
  page?: number
  pageSize?: number
  service?: string
  success?: number // 0/1
  operationKeyword?: string
  startDate?: string
  endDate?: string
}

/** 操作日志列表项（沿用现有 AdminOperationLogItem 结构，复用即可，此处仅声明查询参数） */
export interface OperationLogListQueryV2 {
  page?: number
  pageSize?: number
  action?: string
  keyword?: string
  startDate?: string
  endDate?: string
}

/** 通用分页列表响应（三子页共用） */
export interface LogListResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 三子页各自的响应类型别名 */
export type ApiCallLogListResult = LogListResult<ApiCallLogItem>
export type CloudServiceLogListResult = LogListResult<CloudServiceLogItem>
// 操作日志复用现有 AdminOperationLogListResult（来自 adminOperationLog.d.ts）
