import { register } from '~/api/user/register'
import type { RegisterPayload } from '#shared/types/user'

/**
 * 注册业务 Hook：组装 API + 提示文案 + 通用请求能力
 */
export function useToRegister() {
  const registerCfg = createResCfg<RegisterPayload, null>({
    handle: register,
    success: '注册成功',
    clientFail: '参数校验失败',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(registerCfg)

  return { isLoading, execute }
}