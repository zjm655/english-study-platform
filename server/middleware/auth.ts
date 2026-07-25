import type { JwtPayload } from '#server/types/jwtPayload'
import { query } from '#server/utils/db'
import { isAdminOrAbove, isSuperAdmin } from '#shared/utils/role'
import { ALL_PERMISSIONS } from '#shared/utils/permission'
import { getUserPermissions } from '#server/utils/permission'
import { getRateLimitConfig, checkUserRateLimit } from '#server/utils/rateLimiter'

// 全局服务端中间件：每次请求自动解析 Cookie 中的 JWT
export default defineEventHandler(async (event) => {
  // 1. 公开路由白名单，这些接口不需要登录
  const publicPaths = ['/api/user/login', '/api/user/register', '/api/user/captcha']

  if (publicPaths.some((p) => event.path === p)) return
  else if (!event.path.startsWith('/api')) return

  // 2. 从 Cookie 取 token
  const token = getCookie(event, 'token')
  if (!token) {
    // 可选鉴权：公开只读路径（单元列表/详情）游客直接放行，不挂 event.context.user，
    // handler 内据此返回裁剪版；持 token 的请求（含坏 token）仍走下方完整验证，
    // 登录用户数据形态不变、坏 token 仍 401+清 cookie
    if (isPublicReadPath(event.method, event.path)) return
    return validateError('未登录', 401)
  }

  // 3. 验证 token 签名，解析出用户载荷
  let payload: JwtPayload
  try {
    payload = await verifyToken(token)
  } catch {
    // token 无效时清除 Cookie，避免客户端一直带坏 token
    deleteCookie(event, 'token')
    return validateError('Token 无效或已过期!', 401)
  }

  // 4. 校验用户是否仍存在、未销号、未被封禁，并以 DB 的 role 为权威（防止旧 token 指向已删除用户，或降权后持旧 token 越权）。
  //    主键索引查询，开销极小；封禁/销号由此即时生效（不依赖 JWT 过期）。
  const rows = await query<{ id: number; role: number; status: number; deleted_at: string | null }>(
    'SELECT id, role, status, deleted_at FROM user WHERE id = ? LIMIT 1',
    [payload.id],
  )
  if (rows.length === 0) {
    deleteCookie(event, 'token')
    return validateError('登录状态已失效，请重新登录', 401)
  }
  const dbUser = rows[0]!
  if (dbUser.deleted_at) {
    deleteCookie(event, 'token')
    return validateError('账号已注销', 401)
  }
  if (dbUser.status === 0) {
    deleteCookie(event, 'token')
    return validateError('账号已被封禁', 403)
  }

  // 5. 挂载用户信息到 event.context（role 以 DB 值为准，而非 JWT 快照）
  //    同时注入权限键集合供 handler 细粒度守卫：
  //    - 普通用户（role < ADMIN）直接空数组，零额外查询、无性能回归（占比 99% 的请求）
  //    - 超管注入 ALL_PERMISSIONS 哨兵（实际判定在 userHasPermission 里走 role 短路）
  //    - 管理员走每用户 60s 缓存（授权后精确失效）
  const role = dbUser.role
  let permissions: string[] = []
  if (isSuperAdmin(role)) {
    permissions = ALL_PERMISSIONS
  } else if (isAdminOrAbove(role)) {
    permissions = [...(await getUserPermissions(payload.id))]
  }
  event.context.user = {
    id: payload.id,
    nickname: payload.nickname,
    role,
    email: payload.email,
    permissions,
  }

  // 6. 用户级限流检查（上传路径独立于全局 enabled）
  const rateLimitConfig = await getRateLimitConfig()
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const { allowed, retryAfter } = checkUserRateLimit(ip, event.path, dbUser.id, rateLimitConfig)
  if (!allowed) {
    event.node.res.statusCode = 429
    event.node.res.setHeader('Retry-After', String(retryAfter))
    return validateError(`请求过于频繁，请 ${retryAfter} 秒后重试`, 429)
  }

  // 7. 管理员路由前缀门禁：/api/admin/* 仅管理员可访问（handler 内校验作纵深防御）。
  //    前缀带尾斜杠，避免误伤假想的 /api/adminXxx。
  if (event.path.startsWith('/api/admin/') && !isAdminOrAbove(event.context.user.role)) {
    return validateError('无管理员权限', 403)
  }
})
