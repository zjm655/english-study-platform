import { recordingPath } from '~/api/paths'
import type { Recording } from '#shared/types/recording'

/** 评测失败原因（SDK 结构化上报，P2-A：写入 recording.analyze_error） */
export interface AnalyzeFailBody {
  errorCode?: string
  errorMessage?: string
}

export const markAnalyzeFail = async (id: number, error?: AnalyzeFailBody) => {
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
