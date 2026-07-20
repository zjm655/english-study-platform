import type { JwtPayload } from "#server/types/jwtPayload"
import { query } from "#server/utils/db"

// 全局服务端中间件：每次请求自动解析 Cookie 中的 JWT
export default defineEventHandler(async (event) => {
  // 1. 公开路由白名单，这些接口不需要登录
  const publicPaths = ['/api/user/login', '/api/user/register']

  if (publicPaths.some(p => event.path === p)) return
  else if(!event.path.startsWith('/api'))return

  // 2. 从 Cookie 取 token
  const token = getCookie(event, 'token')
  if (!token) return validateError("未登录", 401)

  // 3. 验证 token 签名，解析出用户载荷
  let payload: JwtPayload
  try {
    payload = await verifyToken(token)
  } catch {
    // token 无效时清除 Cookie，避免客户端一直带坏 token
    deleteCookie(event, 'token')
    return validateError("Token 无效或已过期!", 401)
  }

  // 4. 校验用户是否仍存在：防止旧 token 指向已删除/不存在的用户（如切换或重建数据库后），
  //    否则下游写操作会因外键约束报 500，而非返回「未登录」。主键索引查询，开销极小。
  const rows = await query<{ id: number }>('SELECT id FROM user WHERE id = ? LIMIT 1', [payload.id])
  if (rows.length === 0) {
    deleteCookie(event, 'token')
    return validateError("登录状态已失效，请重新登录", 401)
  }

  // 5. 挂载用户信息到 event.context
  event.context.user = {
    id: payload.id,
    nickname: payload.nickname,
    role: payload.role,
    email: payload.email
  }
})