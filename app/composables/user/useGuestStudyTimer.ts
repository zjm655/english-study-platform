import { useStudyTimer } from './useStudyTimer'
import { useUserStore } from '~/store/useUserStore'
import { putGuestStudyTime } from '~/api/guest'

/**
 * 游客学习时长计时器（挂在 GUEST_PAGES 内的浏览页）。
 * - 登录用户在这些页不计时（保持现状，避免改变统计口径）——仅游客生效
 * - 复用 useStudyTimer，但传入「全静默」上报函数：任何失败吞掉，绝不弹 toast / 跳登录
 * - 上报响应带回 guestDisplayId，写 localStorage 仅作展示冗余（身份真相在 httpOnly cookie）
 */
export function useGuestStudyTimer() {
  const userStore = useUserStore()
  if (userStore.isLogin) return

  useStudyTimer((seconds) => {
    putGuestStudyTime(seconds)
      .then((res) => {
        const displayId = res?.data?.guestDisplayId
        if (displayId && import.meta.client) {
          localStorage.setItem('visitor_display_id', displayId)
        }
      })
      .catch(() => {
        // 游客上报全静默：网络/鉴权任何异常均忽略，不影响浏览体验
      })
  })
}
