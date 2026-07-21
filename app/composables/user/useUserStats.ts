import { getUserStats } from '~/api/user/stats'
import type { UserStats } from '#shared/types/user'

/** 用户学习统计：已完成片段数、配音平均分、最近学习时间 */
export const useUserStats = () => {
  const cfg = createResCfg<undefined, UserStats>({
    handle: () => getUserStats(),
    success: '获取学习统计成功',
    clientFail: '获取学习统计失败',
    serverFail: '服务器异常，获取学习统计失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}