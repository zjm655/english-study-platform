import { useToVerify, useCheckinRefresh } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'
import { isAdminOrAbove, isSuperAdmin } from '#shared/utils/role'
import { PERMISSIONS } from '#shared/utils/permission'
import type { PermissionKey } from '#shared/utils/permission'

// 后台页面路径前缀 → 所需权限（与侧边栏/后端门禁口径一致；仅体验层，真正防线在后端）
const ADMIN_PAGE_PERMISSIONS: [prefix: string, permission: PermissionKey][] = [
  ['/admin/material', PERMISSIONS.MANAGE_MATERIALS],
  ['/admin/unit', PERMISSIONS.MANAGE_MATERIALS],
  ['/admin/users', PERMISSIONS.MANAGE_USERS],
  ['/admin/stats', PERMISSIONS.VIEW_STATS],
  ['/admin/cloud', PERMISSIONS.VIEW_STATS],
  ['/admin/logs', PERMISSIONS.VIEW_LOGS],
  ['/admin/config', PERMISSIONS.CONFIG],
]

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

  // 管理员路由守卫：/admin/* 仅管理员/超管可访问（防误入；真正防线在后端 /api/admin/* 门禁）
  if (to.path.startsWith('/admin')) {
    const user = userStore.user
    if (!isAdminOrAbove(user?.role)) {
      return navigateTo('/')
    }
    // 页面级权限守卫：无对应权限时重定向到 /admin 首页（超管隐式全权跳过）
    if (!isSuperAdmin(user?.role)) {
      const matched = ADMIN_PAGE_PERMISSIONS.find(([prefix]) => to.path.startsWith(prefix))
      if (matched && !(user?.permissions?.includes(matched[1]) ?? false)) {
        return navigateTo('/admin')
      }
    }
  }
})
