import { materialRecordsPath } from '../paths'
import type {
  MaterialUploadRecordListItem,
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
