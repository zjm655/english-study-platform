import { recordingPath } from '../paths'
import { getGuestFingerprint } from '~/utils/fingerprint'
import type { Recording } from '#shared/types/recording'

export const markAnalyzeFail = async (id: number) => {
  // 游客身份（无 token cookie）时附加浏览器指纹 header
  const headers: Record<string, string> = {}
  if (!useCookie('token').value) {
    const fp = await getGuestFingerprint()
    if (fp) headers['x-guest-fingerprint'] = fp
  }

  return request<Recording>(`${recordingPath}/${id}/analyze-fail`, {
    method: 'POST',
    headers,
  })
}
