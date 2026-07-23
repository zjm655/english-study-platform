import { postCheckinRefresh } from '~/api/user/checkinRefresh'
import type { CheckinStats } from '#shared/types/user'

export const useCheckinRefresh = () => {
  const cfg = createResCfg<null, CheckinStats>({
    handle: postCheckinRefresh,
    success: '',
    clientFail: '登录已过期',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(cfg)

  async function refresh() {
    const res = await execute(null)
    return res
  }

  return { isLoading, execute: refresh }
}
