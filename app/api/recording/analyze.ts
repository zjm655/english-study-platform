import { recordingPath } from '../paths'
import type { Recording } from '#shared/types/recording'

export const analyzeRecording = async (id: number, result: Record<string, unknown>) => {
  return request<Recording>(`${recordingPath}/${id}/analyze`, {
    method: 'POST',
    body: { result },
  })
}
