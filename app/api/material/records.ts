import { materialRecordsPath } from '../paths'
import type { MaterialUploadRecordListItem, UpdateMaterialRecordPayload } from '#shared/types/material'

interface ListOptions {
  limit?: number
  offset?: number
}

export const getMaterialRecords = async (options: ListOptions = {}) => {
  const params = new URLSearchParams()
  if (options.limit) params.append('limit', String(options.limit))
  if (options.offset) params.append('offset', String(options.offset))
  const query = params.toString()
  return request.json<MaterialUploadRecordListItem[]>(
    `${materialRecordsPath}${query ? '?' + query : ''}`
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
