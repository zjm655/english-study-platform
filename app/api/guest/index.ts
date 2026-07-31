import { guestStudyTimePath, guestAudioUrlPath, guestEvalQuotaPath } from '~/api/paths'
import { request } from '~/utils/request'
import type { GuestStudyResult } from '#shared/types/user'

/**
 * 游客学习时长上报（裸 request，不接 useHandleRes）。
 * 游客上报绝不能走 useHandleRes——其 silent 模式仍保留 401/403 鉴权跳转，
 * 会把游客踢到 /login，毁掉游客体验。此处返回原始 ResPayload，调用方全静默处理。
 */
export const putGuestStudyTime = (studySeconds: number) => {
  return request<GuestStudyResult>(guestStudyTimePath, {
    method: 'PUT',
    body: { studySeconds },
  })
}

/** 游客获取音频签名 URL 的返回类型 */
interface GuestAudioUrlResult {
  url: string
}

/**
 * 游客获取音频签名 URL（限流）。
 * 返回原始 ResPayload，调用方静默处理（429 时提示用户）。
 */
export const getGuestAudioUrl = (type: 'material' | 'word', key: string) => {
  return request<GuestAudioUrlResult>(guestAudioUrlPath, {
    method: 'GET',
    query: { type, key },
  })
}

/** 游客评测配额查询返回类型 */
export interface GuestEvalQuotaResult {
  dubbing: { used: number; limit: number }
  shadow: { used: number; limit: number }
}

/**
 * 游客评测配额查询：返回当日配音/影子跟读已用次数与上限。
 * 返回原始 ResPayload，调用方静默处理（不触发鉴权跳转）。
 */
export const getGuestEvalQuota = () => {
  return request<GuestEvalQuotaResult>(guestEvalQuotaPath, {
    method: 'GET',
  })
}
