/**
 * 用户角色常量（与 user.role 字段取值一致）。
 * 前后端共用，避免散落魔法数字 `role === 1`。
 */
export const ROLE_USER = 0
export const ROLE_ADMIN = 1
/** 超级管理员：唯一可授予权限/变更角色者，隐式持有全部权限 */
export const ROLE_SUPER_ADMIN = 2

/**
 * 是否为管理员或更高（管理员 / 超级管理员）。
 * 新增超管后，凡「能否进入管理后台 / 享受管理员待遇」的判定一律用此 helper，
 * 杜绝散落的 `role === ROLE_ADMIN` 等值判断把超管误判为普通用户。
 */
export function isAdminOrAbove(role: number | null | undefined): boolean {
  return typeof role === 'number' && role >= ROLE_ADMIN
}

/** 是否为超级管理员。 */
export function isSuperAdmin(role: number | null | undefined): boolean {
  return role === ROLE_SUPER_ADMIN
}
