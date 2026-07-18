import { recordingPath } from '../paths'
import type { RecordingListQuery, PaginatedRecordings } from '#shared/types/recording'

export const getRecordingList = async (query: RecordingListQuery) => {
  const params = new URLSearchParams({
    segmentId: String(query.segmentId),
  })
  if (query.phase !== undefined && query.phase !== null) {
    params.set('phase', String(query.phase))
  }
  if (query.page !== undefined) {
    params.set('page', String(query.page))
  }
  if (query.size !== undefined) {
    params.set('size', String(query.size))
  }
  return request<PaginatedRecordings>(`${recordingPath}?${params.toString()}`, {
    method: 'GET',
  })
}
