import { materialRecordsPath } from '../paths'
import type {
  MaterialUploadRecordListItem,
  MaterialRecordStatusItem,
  UpdateMaterialRecordPayload,
} from '#shared/types/material'

interface ListOptions {
  limit?: number
  offset?: number
}

export const getMaterialRecords = async (options: ListOptions = {}) => {
  return request.json<MaterialUploadRecordListItem[]>(
    `${materialRecordsPath}${buildQuery({ limit: options.limit, offset: options.offset })}`,
  )
}

/** 批量查询上传任务状态（轮询轻接口，仅返回自己的记录） */
export const getMaterialRecordStatuses = async (ids: number[]) => {
  return request.json<MaterialRecordStatusItem[]>(
    `${materialRecordsPath}/status${buildQuery({ ids: ids.join(',') })}`,
  )
}

export const updateMaterialRecord = async (id: number, payload: UpdateMaterialRecordPayload) => {
  return request.json<null>(`${materialRecordsPath}/${id}`, {
    method: 'PUT',
    body: payload,
  })
}

export const deleteMaterialRecord = async (id: number) => {
  return request.json<null>(`${materialRecordsPath}/${id}`, {
    method: 'DELETE',
  })
}
