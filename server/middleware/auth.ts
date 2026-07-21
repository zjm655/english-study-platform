import type { JwtPayload } from '#server/types/jwtPayload'
import { query } from '#server/utils/db'
import { ROLE_ADMIN } from '#shared/utils/role'

// 全局服务端中间件：每次请求自动解析 Cookie 中的 JWT
export default defineEventHandler(async (event) => {
  // 1. 公开路由白名单，这些接口不需要登录
  const publicPaths = ['/api/user/login', '/api/user/register']

  if (publicPaths.some((p) => event.path === p)) return
  else if (!event.path.startsWith('/api')) return

  // 2. 从 Cookie 取 token
  const token = getCookie(event, 'token')
  if (!token) return validateError('未登录', 401)

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
  event.context.user = {
    id: payload.id,
    nickname: payload.nickname,
    role: dbUser.role,
    email: payload.email,
  }

  // 6. 管理员路由前缀门禁：/api/admin/* 仅管理员可访问（handler 内校验作纵深防御）。
  //    前缀带尾斜杠，避免误伤假想的 /api/adminXxx。
  if (event.path.startsWith('/api/admin/') && event.context.user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }
})
