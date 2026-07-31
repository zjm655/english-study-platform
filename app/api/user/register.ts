import type { RegisterPayload } from '~~/shared/types/user'
import { userRegisterPath } from '../paths'
import { getGuestFingerprint } from '~/utils/fingerprint'

export const register = async (payload: RegisterPayload) => {
  // 游客注册：附加浏览器指纹 header，供服务端合并指纹孤儿行数据
  const headers: Record<string, string> = {}
  if (!useCookie('token').value) {
    const fp = await getGuestFingerprint()
    if (fp) headers['x-guest-fingerprint'] = fp
  }

  const res = await request<null>(userRegisterPath, {
    method: 'POST',
    body: payload,
    headers,
  })

  return res
}
