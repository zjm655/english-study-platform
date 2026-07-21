import { userStatsPath } from '~/api/paths'
import type { UserStats } from '#shared/types/user'

export const getUserStats = async () => {
  const res = await request<UserStats>(userStatsPath, {
    method: 'GET',
  })
  return res
}
