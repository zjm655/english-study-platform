import { userStudyTimePath } from '~/api/paths'
import type { CheckinStats } from '#shared/types/user'

export const putStudyTime = async (studySeconds: number) => {
  const res = await request<CheckinStats>(userStudyTimePath, {
    method: 'PUT',
    body: { studySeconds },
  })
  return res
}
