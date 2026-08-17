import { adminMaterialRecordPath, adminMaterialRecordBatchPath } from '~/api/paths'
import type {
  AdminMaterialRecordListQuery,
  AdminMaterialRecordListResult,
  AdminMaterialRecordDetail,
  AdminMaterialRecordDiag,
  AdminMaterialRecordReprocessPayload,
} from '#shared/types/adminMaterialRecord'
import type { AuditionPayload, AuditionResult } from '#shared/types/adminPermission'
import type { MaterialRecordStatusItem } from '#shared/types/material'
import type { AdminMaterialRecordBatchPayload, BatchResult } from '#shared/types/adminBatch'

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

/** 管理员获取上传记录诊断详情（快照/说话人标注/音频/成功时学习产物） */
export const getAdminMaterialRecordDiag = (id: number) => {
  return request.json<AdminMaterialRecordDiag>(`${adminMaterialRecordPath}/${id}/diag`)
}

/** 管理员采用说话人标注（回写 text_content） */
export const adoptSpeakerAnnotation = (id: number) => {
  return request.json<null>(`${adminMaterialRecordPath}/${id}/speaker-annotate`, {
    method: 'POST',
  })
}

/** 批量查询上传任务状态（轮询轻接口，可查所有用户记录） */
export const getAdminMaterialRecordStatuses = (ids: number[]) => {
  return request.json<MaterialRecordStatusItem[]>(
    `${adminMaterialRecordPath}/status${buildQuery({ ids: ids.join(',') })}`,
  )
}

/** 管理员删除上传记录 */
export const deleteAdminMaterialRecord = (id: number) => {
  return request.json<null>(`${adminMaterialRecordPath}/${id}`, { method: 'DELETE' })
}

/** 管理员批量操作上传记录（delete=批量删除 / reprocess=批量重试，部分成功语义） */
export const batchAdminMaterialRecords = (payload: AdminMaterialRecordBatchPayload) => {
  return request.json<BatchResult>(adminMaterialRecordBatchPath, {
    method: 'POST',
    body: payload,
  })
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
