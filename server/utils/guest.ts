// server/utils/guest.ts
// 访客（游客）身份 JWT 工具：与登录态 token 平行的独立身份通道。
//
// 与 auth.ts 的 signToken/verifyToken 复用同一 jwtSecret，但：
// - 独立 cookie 名 `guest_token`（绝不复用 `token`，防实体化后被 auth 中间件当登录态挂载越权）；
// - payload 带 `typ:'guest'` 标记，verifyGuestToken 强制校验，双向隔离用户 token 与游客 token；
// - 游客 payload 不含 id（防塞进 token cookie 触发 auth 中间件 undefined 绑参，见 auth.ts payload.id 防线）。
import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'
import { getSecret } from '#server/utils/auth'

/** 游客 JWT 载荷：仅随机键 + 类型标记，无 id/role（与 JwtPayload 刻意不兼容） */
export interface GuestJwtPayload extends JWTPayload {
  gk: string
  typ: 'guest'
}

/** 游客 cookie 名（独立于登录态 token） */
const GUEST_COOKIE = 'guest_token'
/** 游客 token 有效期：180 天（浏览会话长期留存，过期数据成孤儿由二期清理任务兜底） */
const GUEST_TOKEN_TTL = '180d'
/** cookie maxAge（秒），与 TTL 对齐 */
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

/** 签发游客 token */
export async function signGuestToken(guestKey: string): Promise<string> {
  return new SignJWT({ gk: guestKey, typ: 'guest' } satisfies GuestJwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(GUEST_TOKEN_TTL)
    .setIssuer('Nuxt4Demo')
    .sign(getSecret())
}

/**
 * 验证并解析游客 token。
 * @throws 签名无效/过期/篡改，或 typ!=='guest'（拒用户 token 冒充）/ gk 非字符串
 */
export async function verifyGuestToken(token: string): Promise<GuestJwtPayload> {
  const { payload } = await jwtVerify<GuestJwtPayload>(token, getSecret())
  if (payload.typ !== 'guest' || typeof payload.gk !== 'string' || !payload.gk) {
    throw new Error('not a guest token')
  }
  return payload
}

/**
 * 从请求读取游客 key：读 cookie → 验签，任何异常（无 cookie/坏 token/非游客 token）静默返回 null。
 * 静默降级保证：解析失败一律等价于「无游客身份」，绝不影响任何现有鉴权结果。
 */
export async function readGuestKey(event: H3Event): Promise<string | null> {
  const token = getCookie(event, GUEST_COOKIE)
  if (!token) return null
  try {
    const payload = await verifyGuestToken(token)
    return payload.gk
  } catch {
    return null
  }
}

/** 写入游客 cookie（httpOnly，参数对齐 login.post.ts 的 token cookie） */
export async function setGuestCookie(event: H3Event, guestKey: string): Promise<void> {
  const token = await signGuestToken(guestKey)
  setCookie(event, GUEST_COOKIE, token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: GUEST_COOKIE_MAX_AGE,
    path: '/',
  })
}

/** 清除游客 cookie（合并/转正成功后调用） */
export function clearGuestCookie(event: H3Event): void {
  deleteCookie(event, GUEST_COOKIE)
}
