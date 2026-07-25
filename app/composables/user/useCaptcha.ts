import { getCaptcha } from '~/api/user/captcha'
import type { CaptchaResult } from '#shared/types/user'

/**
 * 图形验证码获取 Hook：组装 API + 提示文案 + 通用请求能力
 */
export function useCaptcha() {
  const cfg = createResCfg<null, CaptchaResult>({
    handle: () => getCaptcha(),
    success: '',
    clientFail: '获取验证码失败',
    serverFail: '服务器异常，获取验证码失败',
    error: '网络异常，请检查网络',
  })

  return useHandleRes(cfg)
}
