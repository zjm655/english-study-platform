import { putUserProgress } from '~/api/unit'
import type { UpdateProgressPayload, SegmentProgress } from '~/api/unit/userProgress'

export const useUpdateProgress = () => {
  const cfg = createResCfg<UpdateProgressPayload, SegmentProgress>({
    handle: putUserProgress,
    success: '更新进度成功',
    clientFail: '更新进度失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}
