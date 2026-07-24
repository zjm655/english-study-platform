import { useUserStore } from '~/store/useUserStore'
import {
  isAdminOrAbove as isAdminOrAboveRole,
  isSuperAdmin as isSuperAdminRole,
} from '#shared/utils/role'
import type { PermissionKey } from '#shared/utils/permission'

/**
 * 前端权限判定（体验层）：仅用于入口/菜单显隐，真正的安全防线是后端每端点 ensurePermission。
 * 超管隐式全权（can 恒 true）；否则查 verify 下发的 permissions 数组（防御式读取 ?? []）。
 */
export function usePermission() {
  const userStore = useUserStore()
  const isSuperAdmin = computed(() => isSuperAdminRole(userStore.user?.role))
  const isAdminOrAbove = computed(() => isAdminOrAboveRole(userStore.user?.role))
  function can(key: PermissionKey): boolean {
    const u = userStore.user
    if (!u) return false
    if (isSuperAdminRole(u.role)) return true
    return u.permissions?.includes(key) ?? false
  }
  return { can, isSuperAdmin, isAdminOrAbove }
}
