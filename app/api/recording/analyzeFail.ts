import { recordingPath } from '../paths'
import type { Recording } from '#shared/types/recording'

export const markAnalyzeFail = async (id: number) => {
  return request<Recording>(`${recordingPath}/${id}/analyze-fail`, {
    method: 'POST',
  })
}
