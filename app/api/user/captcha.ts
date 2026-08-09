import { userCaptchaPath } from '~/api/paths'
import type { CaptchaResult } from '#shared/types/user'

export const getCaptcha = async () => {
  const res = await request<CaptchaResult>(userCaptchaPath, {
    method: 'GET',
  })

  return res
}
