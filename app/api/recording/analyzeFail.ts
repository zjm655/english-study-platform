import { recordingPath } from '~/api/paths'
import type { Recording, AnalyzeFailInput } from '#shared/types/recording'

export const markAnalyzeFail = async (id: number, error?: AnalyzeFailInput) => {
  // 游客身份（无 token cookie）时附加浏览器指纹 header
  const headers: Record<string, string> = {}
  if (!useCookie('token').value) {
    const fp = await getGuestFingerprint()
    if (fp) headers['x-guest-fingerprint'] = fp
  }

  const body = error && (error.errorCode || error.errorMessage) ? error : undefined
  return request.json<Recording>(`${recordingPath}/${id}/analyze-fail`, {
    method: 'POST',
    headers,
    ...(body ? { body } : {}),
  })
}
