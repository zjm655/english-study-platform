import { userCheckinStatsPath } from '~/api/paths'
import type { CheckinStats } from '~~/shared/types/user'

export const getCheckinStats = async () => {
  const res = await request<CheckinStats>(userCheckinStatsPath, {
    method: 'GET',
  })
  return res
}
