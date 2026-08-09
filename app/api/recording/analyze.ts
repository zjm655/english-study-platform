import { recordingPath } from '~/api/paths'
import type { Recording } from '#shared/types/recording'

export const analyzeRecording = async (id: number, result: Record<string, unknown>) => {
  // 游客身份（无 token cookie）时附加浏览器指纹 header，供服务端解析游客身份并校验录音归属
  const headers: Record<string, string> = {}
  if (!useCookie('token').value) {
    const fp = await getGuestFingerprint()
    if (fp) headers['x-guest-fingerprint'] = fp
  }

  return request<Recording>(`${recordingPath}/${id}/analyze`, {
    method: 'POST',
    body: { result },
    headers,
  })
}
