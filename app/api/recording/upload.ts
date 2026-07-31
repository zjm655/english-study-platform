import { recordingPath } from '../paths'
import { getGuestFingerprint } from '~/utils/fingerprint'
import type { UploadRecordingPayload, UploadRecordingResult } from '#shared/types/recording'

export const uploadRecording = async (payload: UploadRecordingPayload) => {
  const formData = new FormData()
  const ext =
    payload.audioBlob.type === 'audio/webm'
      ? 'webm'
      : payload.audioBlob.type === 'audio/ogg'
        ? 'ogg'
        : payload.audioBlob.type === 'audio/wav' || payload.audioBlob.type === 'audio/x-wav'
          ? 'wav'
          : 'mp3'
  formData.append('audio', payload.audioBlob, `recording.${ext}`)
  formData.append('segmentId', String(payload.segmentId))
  formData.append('phase', String(payload.phase))
  formData.append('duration', String(payload.duration))

  // 游客身份（无 token cookie）时附加浏览器指纹 header，供服务端关联录音归属
  const headers: Record<string, string> = {}
  if (!useCookie('token').value) {
    const fp = await getGuestFingerprint()
    if (fp) headers['x-guest-fingerprint'] = fp
  }

  return request.file<UploadRecordingResult>(recordingPath, {
    method: 'POST',
    body: formData,
    headers,
  })
}
