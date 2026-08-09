import { recordingPath } from '~/api/paths'
import type { RecordingListQuery, PaginatedRecordings } from '#shared/types/recording'

export const getRecordingList = async (query: RecordingListQuery) => {
  return request<PaginatedRecordings>(
    `${recordingPath}${buildQuery({
      segmentId: query.segmentId,
      phase: query.phase,
      page: query.page,
      pageSize: query.pageSize,
    })}`,
    { method: 'GET' },
  )
}
