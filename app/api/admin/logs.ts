import {
  adminLogsApiCallListPath,
  adminLogsCloudServiceListPath,
  adminLogsOperationListPath,
} from '../paths'
import { request } from '~/utils/request'
import type {
  ApiCallLogListQuery,
  ApiCallLogListResult,
  CloudServiceLogListQuery,
  CloudServiceLogListResult,
  OperationLogListQueryV2,
} from '#shared/types/adminLogs'
import type { AdminOperationLogListResult } from '#shared/types/adminOperationLog'

/** API 调用日志列表 */
export const getApiCallLogList = (options: ApiCallLogListQuery = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.append('page', String(options.page))
  if (options.pageSize !== undefined) params.append('pageSize', String(options.pageSize))
  if (options.method) params.append('method', options.method)
  if (options.statusCodeGroup) params.append('statusCodeGroup', options.statusCodeGroup)
  if (options.pathKeyword) params.append('pathKeyword', options.pathKeyword)
  if (options.userId !== undefined) params.append('userId', String(options.userId))
  if (options.startDate) params.append('startDate', options.startDate)
  if (options.endDate) params.append('endDate', options.endDate)
  const query = params.toString()
  return request.json<ApiCallLogListResult>(
    `${adminLogsApiCallListPath}${query ? '?' + query : ''}`,
  )
}

/** 云服务调用日志列表 */
export const getCloudServiceLogList = (options: CloudServiceLogListQuery = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.append('page', String(options.page))
  if (options.pageSize !== undefined) params.append('pageSize', String(options.pageSize))
  if (options.service) params.append('service', options.service)
  if (options.success !== undefined) params.append('success', String(options.success))
  if (options.operationKeyword) params.append('operationKeyword', options.operationKeyword)
  if (options.startDate) params.append('startDate', options.startDate)
  if (options.endDate) params.append('endDate', options.endDate)
  const query = params.toString()
  return request.json<CloudServiceLogListResult>(
    `${adminLogsCloudServiceListPath}${query ? '?' + query : ''}`,
  )
}

/** 操作日志列表（统一日志管理子页用，含日期范围） */
export const getOperationLogListV2 = (options: OperationLogListQueryV2 = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.append('page', String(options.page))
  if (options.pageSize !== undefined) params.append('pageSize', String(options.pageSize))
  if (options.action) params.append('action', options.action)
  if (options.keyword) params.append('keyword', options.keyword)
  if (options.startDate) params.append('startDate', options.startDate)
  if (options.endDate) params.append('endDate', options.endDate)
  const query = params.toString()
  return request.json<AdminOperationLogListResult>(
    `${adminLogsOperationListPath}${query ? '?' + query : ''}`,
  )
}
