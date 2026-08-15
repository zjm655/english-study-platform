import {
  adminLogsApiCallListPath,
  adminLogsCloudServiceListPath,
  adminLogsOperationListPath,
  adminLogsReviewAccessListPath,
  adminLogsCleanPath,
  adminLogsArchiveStatsPath,
  adminLogsArchivePurgePath,
  adminLogsArchiveListPath,
  adminLogsEventsPath,
} from '~/api/paths'
import type {
  ApiCallLogListQuery,
  ApiCallLogListResult,
  CloudServiceLogListQuery,
  CloudServiceLogListResult,
  OperationLogListQueryV2,
  ReviewAccessLogListQuery,
  ReviewAccessLogListResult,
  LogArchiveStatsResult,
  ArchiveListResult,
  AlertEventListResult,
  ArchiveListQuery,
  AlertEventListQuery,
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

/** 按时间范围归档清理指定日志表（迁入归档表后从原表删除） */
export const cleanLogs = (payload: { table: string; days: number }) =>
  request.json<{ archivedRows: number }>(adminLogsCleanPath, {
    method: 'POST',
    body: payload,
  })

/** 三张归档表统计（行数 + 原始日志时间范围） */
export const getLogArchiveStats = () =>
  request.json<LogArchiveStatsResult>(adminLogsArchiveStatsPath)

/** 彻底删除归档表中超期数据（物理删除，不可恢复） */
export const purgeLogArchive = (payload: { table: string; days: number }) =>
  request.json<{ deletedRows: number }>(adminLogsArchivePurgePath, {
    method: 'POST',
    body: payload,
  })

/** 归档表只读浏览（P2-B：三张归档表分页列表，只读不清理；query 从 schema 推导，P3-H） */
export const getArchiveList = (options: ArchiveListQuery) =>
  request.json<ArchiveListResult>(
    `${adminLogsArchiveListPath}${buildQuery({
      table: options.table,
      page: options.page,
      pageSize: options.pageSize,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )

/** 告警事件列表（A1：alert_event 只读浏览；query 从 schema 推导，P3-H） */
export const getAlertEvents = (options: AlertEventListQuery) =>
  request.json<AlertEventListResult>(
    `${adminLogsEventsPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      source: options.source,
      level: options.level,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
  )
