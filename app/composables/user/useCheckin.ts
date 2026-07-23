import { postCheckin } from '~/api/user/checkin'
import type { CheckinStats } from '#shared/types/user'

export const useCheckin = () => {
  const checkinCfg = createResCfg<null, CheckinStats>({
    handle: postCheckin,
    success: '签到成功',
    clientFail: '登录已过期',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(checkinCfg)

  async function doCheckin() {
    const res = await execute(null)
    return res
  }

  return { isLoading, execute: doCheckin }
}
