import { adminMaterialRecordPath } from '../paths'
import type {
  AdminMaterialRecordListQuery,
  AdminMaterialRecordListResult,
  AdminMaterialRecordDetail,
  AdminMaterialRecordReprocessPayload,
} from '#shared/types/adminMaterialRecord'

/** 管理员上传记录列表 */
export const getAdminMaterialRecordList = (options: AdminMaterialRecordListQuery = {}) => {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.append('page', String(options.page))
  if (options.pageSize !== undefined) params.append('pageSize', String(options.pageSize))
  if (options.status) params.append('status', options.status)
  if (options.source && options.source !== 'all') params.append('source', options.source)
  if (options.startDate) params.append('startDate', options.startDate)
  if (options.endDate) params.append('endDate', options.endDate)
  const query = params.toString()
  return request.json<AdminMaterialRecordListResult>(
    `${adminMaterialRecordPath}${query ? '?' + query : ''}`,
  )
}

/** 管理员获取上传记录详情 */
export const getAdminMaterialRecordDetail = (id: number) => {
  return request.json<AdminMaterialRecordDetail>(`${adminMaterialRecordPath}/${id}`)
}

/** 管理员删除上传记录 */
export const deleteAdminMaterialRecord = (id: number) => {
  return request.json<null>(`${adminMaterialRecordPath}/${id}`, { method: 'DELETE' })
}

/** 管理员重处理失败记录 */
export const reprocessAdminMaterialRecord = (
  id: number,
  payload: AdminMaterialRecordReprocessPayload,
) => {
  return request.json<null>(`${adminMaterialRecordPath}/${id}/reprocess`, {
    method: 'POST',
    body: payload,
  })
}