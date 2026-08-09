import { userCheckinRefreshPath } from '~/api/paths'
import type { CheckinStats } from '#shared/types/user'

export const postCheckinRefresh = async () => {
  const res = await request<CheckinStats>(userCheckinRefreshPath, {
    method: 'POST',
  })
  return res
}
