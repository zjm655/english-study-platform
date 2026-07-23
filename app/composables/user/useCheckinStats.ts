import { getCheckinStats } from '~/api/user/checkinStats'
import type { CheckinStats } from '#shared/types/user'

export const useCheckinStats = () => {
  const statsCfg = createResCfg<null, CheckinStats>({
    handle: getCheckinStats,
    success: '获取打卡统计成功',
    clientFail: '登录已过期',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(statsCfg)

  async function fetchCheckinStats() {
    const res = await execute(null)
    return res
  }

  return { isLoading, execute: fetchCheckinStats }
}
