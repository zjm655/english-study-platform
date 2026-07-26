import { useToVerify, useCheckinRefresh } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'
import { isAdminOrAbove, isSuperAdmin } from '#shared/utils/role'
import { PERMISSIONS } from '#shared/utils/permission'
import type { PermissionKey } from '#shared/utils/permission'

// 后台页面路径前缀 → 所需权限（与侧边栏/后端门禁口径一致；仅体验层，真正防线在后端）
// 注意：匹配用 .find 前缀首命中，更具体的路径（如 /admin/logs/review-access）必须排在其父前缀之前
const ADMIN_PAGE_PERMISSIONS: [prefix: string, permission: PermissionKey][] = [
  ['/admin/material', PERMISSIONS.MANAGE_MATERIALS],
  ['/admin/unit', PERMISSIONS.MANAGE_MATERIALS],
  ['/admin/users', PERMISSIONS.MANAGE_USERS],
  ['/admin/stats', PERMISSIONS.VIEW_STATS],
  ['/admin/cloud', PERMISSIONS.VIEW_STATS],
  ['/admin/logs/review-access', PERMISSIONS.VIEW_AUDIT],
  ['/admin/monitor', PERMISSIONS.CONFIG],
  ['/admin/logs', PERMISSIONS.VIEW_LOGS],
  ['/admin/config', PERMISSIONS.CONFIG],
]

// 游客可浏览页面（精确正则，不用前缀匹配）：片段学习页 /learn/unit/:id/segment/:segId 不含，
// 游客点击片段仍走 verify → 401 → /login 链路（行为与现状一致）
const GUEST_PAGES: RegExp[] = [/^\/$/, /^\/login/, /^\/learn$/, /^\/learn\/unit\/\d+$/]

// 签到刷新每客户端会话仅一次，与 isVerify 解耦（SSR 已验证时 client 不再进 !isVerify 块）
let checkinRequested = false

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const userStore = useUserStore()

  // 登录态校验（一次/会话；SSR 已由 authVerify.server 插件校验时，
  // isVerify 经 payload 恢复为 true 直接跳过；/admin ssr:false 等无 payload 场景走此兜底）
  if (!userStore.isVerify) {
    // 游客（无 token）访问白名单页跳过 verify：避免「verify 401 → resolveCode → 弹 /login」；
    // 不置 isVerify，进入非白名单页时仍会校验
    if (!useCookie('token').value && GUEST_PAGES.some((re) => re.test(to.path))) {
      return
    }
    const verify = useToVerify()
    await verify.userToVerify()
    userStore.isVerify = true
  }

  // 登录态确认后刷新连续天数（fire-and-forget：不 await，失败静默；游客不发）
  if (userStore.isLogin && !checkinRequested) {
    checkinRequested = true
    useCheckinRefresh()
      .execute()
      .then((res) => {
        if (res?.code === 200 && res.data) {
          userStore.checkinStats = res.data
        }
      })
      .catch(() => {
        // 静默：刷新失败不影响页面访问
      })
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
