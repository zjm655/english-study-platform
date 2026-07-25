import {
  adminLogsApiCallListPath,
  adminLogsCloudServiceListPath,
  adminLogsOperationListPath,
  adminLogsReviewAccessListPath,
  adminLogsCleanPath,
} from '../paths'
import { request } from '~/utils/request'
import type {
  ApiCallLogListQuery,
  ApiCallLogListResult,
  CloudServiceLogListQuery,
  CloudServiceLogListResult,
  OperationLogListQueryV2,
  ReviewAccessLogListQuery,
  ReviewAccessLogListResult,
} from '#shared/types/adminLogs'
import type { AdminOperationLogListResult } from '#shared/types/adminOperationLog'

/** API 调用日志列表 */
export const getApiCallLogList = (options: ApiCallLogListQuery = {}) => {
  return request.json<ApiCallLogListResult>(
    `${adminLogsApiCallListPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      method: options.method,
      statusCodeGroup: options.statusCodeGroup,
      pathKeyword: options.pathKeyword,
      userId: options.userId,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )
}

/** 云服务调用日志列表 */
export const getCloudServiceLogList = (options: CloudServiceLogListQuery = {}) => {
  return request.json<CloudServiceLogListResult>(
    `${adminLogsCloudServiceListPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      service: options.service,
      success: options.success,
      operationKeyword: options.operationKeyword,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )
}

/** 操作日志列表（统一日志管理子页用，含日期范围） */
export const getOperationLogListV2 = (options: OperationLogListQueryV2 = {}) => {
  return request.json<AdminOperationLogListResult>(
    `${adminLogsOperationListPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      action: options.action,
      keyword: options.keyword,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )
}

/** 审核留痕列表（view_audit 门禁，监督 REVIEW 敏感操作） */
export const getReviewAccessLogList = (options: ReviewAccessLogListQuery = {}) => {
  return request.json<ReviewAccessLogListResult>(
    `${adminLogsReviewAccessListPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      targetType: options.targetType,
      reasonCategory: options.reasonCategory,
      keyword: options.keyword,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )
}

/** 按时间范围清理指定日志表 */
export const cleanLogs = (payload: { table: string; days: number }) =>
  request.json<{ deletedRows: number }>(adminLogsCleanPath, {
    method: 'POST',
    body: payload,
  })
