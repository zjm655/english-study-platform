import { guestStudyTimePath } from '~/api/paths'
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
