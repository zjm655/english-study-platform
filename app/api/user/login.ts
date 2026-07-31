import { userLoginPath } from '../paths'
import { getGuestFingerprint } from '~/utils/fingerprint'
import type { LoginPayload, LoginResPayload } from '~~/shared/types/user'

export const login = async (payload: LoginPayload) => {
  // 游客登录：附加浏览器指纹 header，供服务端合并指纹孤儿行数据
  const headers: Record<string, string> = {}
  if (!useCookie('token').value) {
    const fp = await getGuestFingerprint()
    if (fp) headers['x-guest-fingerprint'] = fp
  }

  const res = await request<LoginResPayload>(userLoginPath, {
    method: 'POST',
    body: payload,
    headers,
  })

  return res
}
