import { useToVerify, useCheckinRefresh } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'
import { ROLE_ADMIN } from '#shared/utils/role'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const userStore = useUserStore()

  // 登录态校验（一次/会话）
  if (!userStore.isVerify) {
    const verify = useToVerify()
    await verify.userToVerify()
    userStore.isVerify = true
    // 登录态确认后刷新连续天数（失败静默不阻断导航）
    try {
      const res = await useCheckinRefresh().execute()
      if (res?.code === 200 && res.data) {
        userStore.checkinStats = res.data
      }
    } catch {
      // 静默：刷新失败不影响页面访问
    }
  }

  // 管理员路由守卫：/admin/* 仅管理员可访问（防误入；真正防线在后端 /api/admin/* 门禁）
  if (to.path.startsWith('/admin') && userStore.user?.role !== ROLE_ADMIN) {
    return navigateTo('/')
  }
})
