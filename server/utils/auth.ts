import { SignJWT, jwtVerify} from 'jose'
import type { JwtPayload } from '#server/types/jwtPayload'

// 获取运行时环境里面的jwt密钥，并转换为字符串数组的形式(因为jose生成token要求array string)
function getSecret() {
  return new TextEncoder().encode(useRuntimeConfig().jwtSecret)
}

/**
 * 生成 JWT token
 * @param payload - 写入 token 的数据（用户 id、角色等），不要放敏感信息
 * @returns 签名后的 token 字符串
 */
export async function signToken(payload:JwtPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })   // 签名算法：HMAC + SHA-256
    .setSubject(String(payload.id))
    .setIssuedAt()                          // iat: 签发时间
    .setExpirationTime('7d')                // exp: 7 天后过期
    .setIssuer("Nuxt4Demo")              
    .sign(getSecret())
}

/**
 * 验证并解析 JWT token
 * @param token - 从 Cookie 或 Authorization 头取出的 token
 * @returns 解析后的 payload
 * @throws token 过期、被篡改、格式错误时抛异常
 */
export async function verifyToken(token: string) {
  const { payload }:{payload:JwtPayload} = await jwtVerify<JwtPayload>(token, getSecret())
  return payload
}

