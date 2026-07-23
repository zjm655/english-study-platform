import { postLogout } from '~/api/user/logout'

export const useLogout = () => {
  const logoutCfg = createResCfg<null, null>({
    handle: postLogout,
    success: '已退出登录',
    clientFail: '登录已过期',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(logoutCfg)

  async function doLogout() {
    const res = await execute(null)
    return res
  }

  return { isLoading, execute: doLogout }
}
