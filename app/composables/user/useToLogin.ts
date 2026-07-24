import { login } from '~/api/user/login'
import type { LoginPayload, LoginResPayload } from '#shared/types/user'
import { useUserStore } from '~/store/useUserStore'

/**
 * 登录业务 Hook：组装 API + 提示文案 + 通用请求能力
 */
export function useToLogin() {
  const loginCfg = createResCfg<LoginPayload, LoginResPayload>({
    handle: login,
    success: '登录成功',
    clientFail: '账号或密码错误',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(loginCfg)

  const handleLogin = async (payload: LoginPayload) => {
    const res = await execute(payload)
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

  return { isLoading, handleLogin, execute }
}
