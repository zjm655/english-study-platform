import { recordingPath } from '../paths'
import type { UploadRecordingPayload, UploadRecordingResult } from '#shared/types/recording'

export const uploadRecording = async (payload: UploadRecordingPayload) => {
  const formData = new FormData()
  const ext = payload.audioBlob.type === 'audio/webm' ? 'webm'
    : payload.audioBlob.type === 'audio/ogg' ? 'ogg'
    : payload.audioBlob.type === 'audio/wav' || payload.audioBlob.type === 'audio/x-wav' ? 'wav'
    : 'mp3'
  formData.append('audio', payload.audioBlob, `recording.${ext}`)
  formData.append('segmentId', String(payload.segmentId))
  formData.append('phase', String(payload.phase))
  formData.append('duration', String(payload.duration))

  return request.file<UploadRecordingResult>(recordingPath, {
    method: 'POST',
    body: formData,
  })
}
