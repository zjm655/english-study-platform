import { verify } from '~/api/user/verify'
import type { LoginResPayload } from '#shared/types/user'
import { useUserStore } from '~/store/useUserStore'

export const useToVerify = () => {
  const verifyCfg = createResCfg<null, LoginResPayload>({
    handle: verify,
    success: '登录状态有效',
    clientFail: '登录已过期',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(verifyCfg)

  async function userToVerify() {
    const res = await execute(null)
    if (res && res.code === 200 && res.data) {
      useUserStore().setUser(res.data)
      useUserStore().isLogin = true
    }
    return {
      code: res?.code ?? -1,
      message: res?.message ?? '登录异常',
      data: res?.data,
    }
  }

  return { isLoading, execute, userToVerify }
}
