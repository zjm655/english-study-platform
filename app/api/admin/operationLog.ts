import { adminOperationLogPath } from '../paths'
import type { AdminOperationLogListQuery, AdminOperationLogListResult } from '#shared/types/adminOperationLog'

/** 全局操作日志列表 */
export const getAdminOperationLogList = (options: AdminOperationLogListQuery = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined && options.page !== null)
    params.append('page', String(options.page))
  if (options.pageSize !== undefined && options.pageSize !== null)
    params.append('pageSize', String(options.pageSize))
  if (options.action) params.append('action', options.action)
  if (options.keyword) params.append('keyword', options.keyword)
  const query = params.toString()
  return request.json<AdminOperationLogListResult>(`${adminOperationLogPath}${query ? '?' + query : ''}`)
}
