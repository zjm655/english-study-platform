import { userCheckinPath } from '~/api/paths'
import type { CheckinStats } from '~~/shared/types/user'

export const postCheckin = async () => {
  const res = await request<CheckinStats>(userCheckinPath, {
    method: 'POST'
  })
  return res
}
