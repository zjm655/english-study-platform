import { userLogoutPath } from '~/api/paths'

export const postLogout = async () => {
  const res = await request<null>(userLogoutPath, {
    method: 'POST',
  })
  return res
}
