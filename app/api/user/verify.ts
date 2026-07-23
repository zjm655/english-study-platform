import { userVerifyPath } from '~/api/paths'
import type { LoginResPayload } from '~~/shared/types/user'

export const verify = async () => {
  const res = await request<LoginResPayload>(userVerifyPath, {
    method: 'GET',
  })

  return res
}
