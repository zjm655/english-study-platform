import type { JwtPayload } from "#server/types/jwtPayload"

// 全局服务端中间件：每次请求自动解析 Cookie 中的 JWT
export default defineEventHandler(async (event) => {
  // 1. 公开路由白名单，这些接口不需要登录
  const publicPaths = ['/api/user/login', '/api/user/register']

  if (publicPaths.some(p => event.path === p)) return
  else if(!event.path.startsWith('/api'))return

  // 2. 从 Cookie 取 token
  const token = getCookie(event, 'token')
  if (!token) return validateError("未登录", 401)

  // 3. 验证 token，解析出用户信息挂到 event.context 上
  try {
    const payload:JwtPayload = await verifyToken(token)
    event.context.user = {
      id: payload.id,
      nickname: payload.nickname,
      role: payload.role,
      email: payload.email
    }
  } catch {
    // token 无效时清除 Cookie，避免客户端一直带坏 token
    deleteCookie(event, 'token')
    // throw createError({ status: 401, statusText: 'Token 无效或已过期' })
    return validateError("Token 无效或已过期!", 401)
  }
})