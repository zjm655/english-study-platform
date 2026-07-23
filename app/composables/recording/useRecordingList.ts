import { getRecordingList } from '~/api/recording'
import type { RecordingListQuery, PaginatedRecordings } from '#shared/types/recording'

export const useRecordingList = () => {
  const cfg = createResCfg<RecordingListQuery, PaginatedRecordings>({
    handle: getRecordingList,
    success: '获取录音列表成功',
    clientFail: '获取录音列表失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}
