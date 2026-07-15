import { recordingPath } from '../paths'
import type { UploadRecordingPayload, UploadRecordingResult } from '#shared/types/recording'

export const uploadRecording = async (payload: UploadRecordingPayload) => {
  const formData = new FormData()
  formData.append('audio', payload.audioBlob, 'recording.webm')
  formData.append('segmentId', String(payload.segmentId))
  formData.append('phase', String(payload.phase))
  formData.append('duration', String(payload.duration))

  return request<UploadRecordingResult>(recordingPath, {
    method: 'POST',
    body: formData,
  })
}
