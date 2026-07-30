// server/services/permission.ts
// 细粒度权限运行时：每用户权限缓存 + 端点守卫 + 审核访问留痕 + 门禁试听解锁。
import type { H3Event } from 'h3'
import { readBody, getRequestIP } from 'h3'
import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import type { ResPayload } from '#shared/types/request'
import { isSuperAdmin } from '#shared/utils/role'
import {
  REVIEW_REASON_CATEGORIES,
  type PermissionKey,
  type ReviewReasonCategory,
} from '#shared/utils/permission'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'

/** 每用户权限缓存 TTL（60s）——管理员请求高频，避免每次查库；授权后精确失效。 */
const PERM_CACHE_TTL = 60 * 1000
/** userId -> { 权限键集合, 过期时间戳 }（仿 rateLimiter.ts 的 cachedSwitches 模式） */
const permCache = new Map<number, { perms: Set<string>; expireAt: number }>()

/**
 * 读取某用户的权限键集合（带 60s 每用户内存缓存）。
 * 命中缓存零查询；未命中查 user_permission 表。
 * 超管不应走此函数（auth 层直接注入 ALL_PERMISSIONS 哨兵）。
 */
export async function getUserPermissions(userId: number): Promise<Set<string>> {
  const cached = permCache.get(userId)
  if (cached && Date.now() < cached.expireAt) return cached.perms
  const rows = await query<{ permission_key: string }>(
    'SELECT permission_key FROM user_permission WHERE user_id = ?',
    [userId],
  )
  const perms = new Set(rows.map((r) => r.permission_key))
  permCache.set(userId, { perms, expireAt: Date.now() + PERM_CACHE_TTL })
  return perms
}

/** 使某用户权限缓存失效（授权 / 改角色后调用，确保即时生效不等 TTL）。 */
export function invalidateUserPermissions(userId: number): void {
  permCache.delete(userId)
}

/** 已挂载到 event.context 的用户（auth 中间件注入 role + permissions） */
interface PermissionUser {
  id?: number
  role?: number | null
  permissions?: string[] | null
}

/**
 * 判断用户是否具备某权限（纯内存，不查库）。
 * 超管隐式全权（走 role 短路）；否则查 auth 中间件已注入的 permissions 数组。
 */
export function userHasPermission(
  user: PermissionUser | null | undefined,
  key: PermissionKey,
): boolean {
  if (!user) return false
  if (isSuperAdmin(user.role)) return true
  return Array.isArray(user.permissions) && user.permissions.includes(key)
}

/**
 * 端点守卫：校验当前请求用户是否具备某权限。
 * 失败返回错误载荷（无权限 / 未登录均 403，与旧粗粒度门禁一致；真正的未登录 401 由 auth 中间件前置拦截），
 * 成功返回 null。
 * 用法：`const err = ensurePermission(event, PERMISSIONS.X); if (err) return err`
 */
export function ensurePermission(event: H3Event, key: PermissionKey): ResPayload<null> | null {
  const user = event.context.user as PermissionUser | undefined
  if (!userHasPermission(user, key)) return validateError('无该操作权限', 403)
  return null
}

/** 审核访问留痕入参 */
interface ReviewAccessLogInput {
  operatorId: number | null
  operatorRole: number
  targetType: string
  targetId: number
  targetUserId: number | null
  reasonCategory: string
  reason: string
  ip: string | null
}

/**
 * 写审核访问留痕【同步】。
 * 与 adminLog 的静默吞错不同：审计是「签名前置条件」，写失败必须抛出，
 * 由端点捕获后拒绝签名——绝不产生「已放行但审计丢失」的漏洞。
 */
export async function writeReviewAccessLog(input: ReviewAccessLogInput): Promise<void> {
  await query(
    `INSERT INTO review_access_log
       (operator_id, operator_role, target_type, target_id, target_user_id, reason_category, reason, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.operatorId,
      input.operatorRole,
      input.targetType,
      input.targetId,
      input.targetUserId,
      input.reasonCategory,
      input.reason,
      input.ip,
    ],
  )
}

/** 门禁试听解锁入参（端点已 ensurePermission(REVIEW) 且联表取得 mediaKey/targetUserId） */
interface AuditionUnlockInput {
  targetType: 'material_record' | 'segment'
  targetId: number
  mediaKey: string | null
  targetUserId: number | null
  duration: number | null
}

/**
 * 审核门禁解锁：统一「校验理由 → 同步留痕 → 签名」顺序。
 * 理由类别须在白名单、reason 非空且 ≤500。留痕通过 writeReviewAccessLog（抛错即冒泡，
 * 端点 catch 后返错，绝不签名）；仅当留痕成功才 signUrl 返回签名 URL。
 */
export async function auditionUnlock(
  event: H3Event,
  input: AuditionUnlockInput,
): Promise<ResPayload<{ audioUrl: string; duration: number | null }>> {
  const user = event.context.user as PermissionUser | undefined
  const body = await readBody(event)
  const reasonCategory = typeof body?.reasonCategory === 'string' ? body.reasonCategory.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  if (!REVIEW_REASON_CATEGORIES.includes(reasonCategory as ReviewReasonCategory)) {
    return validateError('请选择合法的查看理由类别', 400)
  }
  if (!reason || reason.length > 500) {
    return validateError('请填写查看理由（1-500 字）', 400)
  }
  if (!input.mediaKey) {
    return validateError('该材料无可试听音频', 404)
  }

  // 同步留痕：写失败即抛出 → 由端点 catch 返回错误，signUrl 永不执行（绝不签名）。
  await writeReviewAccessLog({
    operatorId: user?.id ?? null,
    operatorRole: user?.role ?? 0,
    targetType: input.targetType,
    targetId: input.targetId,
    targetUserId: input.targetUserId,
    reasonCategory,
    reason,
    ip: getRequestIP(event, { xForwardedFor: true }) || null,
  })

  const audioUrl = await signUrl(input.mediaKey, MATERIAL_EXPIRE)
  return validateSuccess(
    { audioUrl, duration: input.duration },
    '已记录本次访问，试听链接有效期约 35 分钟',
  )
}
