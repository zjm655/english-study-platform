import { segmentPath } from '~/api/paths'
import type { SegmentDetail } from '#shared/types/unit'

export const getSegmentDetail = async (segId: number) => {
  return request<SegmentDetail>(`${segmentPath}/${segId}`, { method: 'GET' })
}
