import { adminOperationLogPath } from '~/api/paths'
import type {
  AdminOperationLogListQuery,
  AdminOperationLogListResult,
} from '#shared/types/adminOperationLog'

/** 全局操作日志列表 */
export const getAdminOperationLogList = (options: AdminOperationLogListQuery = {}) => {
  return request.json<AdminOperationLogListResult>(
    `${adminOperationLogPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      action: options.action,
      keyword: options.keyword,
    })}`,
  )
}
