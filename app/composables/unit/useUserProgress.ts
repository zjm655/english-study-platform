import { getUserProgress } from '~/api/unit'
import type { UserProgress } from '#shared/types/unit'

export const useUserProgress = () => {
  const cfg = createResCfg<null, UserProgress>({
    handle: getUserProgress,
    success: '获取学习进度成功',
    clientFail: '获取学习进度失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}
