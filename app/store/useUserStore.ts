// stores/user.ts
import type { CheckinStats } from '#shared/types/user'

export const useUserStore = defineStore('user', () => {
  const user = ref<LoginResPayload | null>(null)
  const isLogin = ref<boolean>(false)
  const isVerify = ref<boolean>(false)
  // 签到统计（登录后由中间件刷新连续天数写入，供个人中心读取）
  const checkinStats = ref<CheckinStats | null>(null)
  function setUser(data: LoginResPayload) {
    user.value = data
  }

  return { user, isLogin, isVerify, checkinStats, setUser }
})