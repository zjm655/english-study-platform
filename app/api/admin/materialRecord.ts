import { adminMaterialRecordPath } from '../paths'
import type {
  AdminMaterialRecordListQuery,
  AdminMaterialRecordListResult,
  AdminMaterialRecordDetail,
  AdminMaterialRecordReprocessPayload,
} from '#shared/types/adminMaterialRecord'
import type { AuditionPayload, AuditionResult } from '#shared/types/adminPermission'

/** 管理员上传记录列表 */
export const getAdminMaterialRecordList = (options: AdminMaterialRecordListQuery = {}) => {
  return request.json<AdminMaterialRecordListResult>(
    `${adminMaterialRecordPath}${buildQuery({
      page: options.page,
      pageSize: options.pageSize,
      status: options.status,
      source: options.source && options.source !== 'all' ? options.source : undefined,
      startDate: options.startDate,
      endDate: options.endDate,
    })}`,
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

/** 审核门禁：上传记录试听解锁（填理由 + 留痕成功后返回签名 URL） */
export const auditionAdminMaterialRecord = (id: number, payload: AuditionPayload) => {
  return request.json<AuditionResult>(`${adminMaterialRecordPath}/${id}/audition`, {
    method: 'POST',
    body: payload,
  })
}
