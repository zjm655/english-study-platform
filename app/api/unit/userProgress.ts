import { userProgressPath } from '../paths'
import type { UserProgress } from '~~/shared/types/unit'

export const getUserProgress = async () => {
  return request<UserProgress>(userProgressPath, { method: 'GET' })
}
