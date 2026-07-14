import { userStudyTimePath } from '~/api/paths'
import type { CheckinStats } from '~~/shared/types/user'

export const putStudyTime = async (studyMinutes: number) => {
  const res = await request<CheckinStats>(userStudyTimePath, {
    method: 'PUT',
    body: { studyMinutes }
  })
  return res
}
