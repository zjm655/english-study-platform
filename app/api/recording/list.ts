import { recordingPath } from '../paths'
import type { RecordingListQuery, Recording } from '#shared/types/recording'

export const getRecordingList = async (query: RecordingListQuery) => {
  const params = new URLSearchParams({
    segmentId: String(query.segmentId),
    ...(query.phase !== undefined && { phase: String(query.phase) }),
  })
  return request<Recording[]>(`${recordingPath}?${params.toString()}`, {
    method: 'GET',
  })
}
