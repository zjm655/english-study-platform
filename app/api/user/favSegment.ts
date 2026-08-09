import { userFavSegmentsPath, userFavSegmentPath } from '~/api/paths'

/** 获取当前用户收藏的片段 ID 列表 */
export const getFavSegmentIds = async () => {
  return request<number[]>(userFavSegmentsPath, { method: 'GET' })
}

/** 收藏/取消收藏片段（toggle） */
export const toggleFavSegment = async (segmentId: number) => {
  return request<{ isFav: boolean }>(userFavSegmentPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { segmentId },
  })
}

/** 检查单个片段是否已收藏 */
export const checkSegmentFavStatus = async (segmentId: number) => {
  return request<{ isFav: boolean }>(`${userFavSegmentPath}/${segmentId}/status`, {
    method: 'GET',
  })
}
