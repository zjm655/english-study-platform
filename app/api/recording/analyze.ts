import { recordingPath } from '../paths'
import type { Recording } from '#shared/types/recording'

export const analyzeRecording = async (id: number) => {
  return request<Recording>(`${recordingPath}/${id}/analyze`, {
    method: 'POST',
  })
}
