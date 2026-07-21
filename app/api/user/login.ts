import { userLoginPath } from '../paths'
import type { LoginPayload, LoginResPayload } from '~~/shared/types/user'

export const login = async (payload: LoginPayload) => {
  const res = await request<LoginResPayload>(userLoginPath, {
    method: 'POST',
    body: payload,
  })

  return res
}
