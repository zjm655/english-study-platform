// server/utils/captcha.ts
// 图形验证码：后端生成 SVG 图 + jose 无状态签名 token。
//
// 设计要点：
// - token 的 payload 仅存验证码答案的 sha256（加 jwtSecret 盐），绝不存明文
//   （JWT payload 仅 base64 编码、客户端可读），校验时重算 hash 比对。
// - 无状态：不依赖 DB / 内存存储，天然支持水平扩展；有效期由 JWT exp 控制。
import { SignJWT, jwtVerify } from 'jose'
import { createHash, randomInt } from 'node:crypto'
import { getSecret } from './auth'

/** 验证码字符集：排除易混字符 0/O/1/l/I */
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
/** 验证码长度 */
const CODE_LENGTH = 4
/** token 有效期（秒） */
const CAPTCHA_TTL_SEC = 5 * 60
/** 干扰线颜色池 */
const COLORS = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399']

/** 生成随机验证码字符串（密码学安全随机源） */
function randomCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[randomInt(0, CHARSET.length)]
  }
  return code
}

/** 随机整数 [min, max]（密码学安全） */
function randInt(min: number, max: number): number {
  return randomInt(min, max + 1)
}

/** 计算验证码答案哈希（小写归一化 + jwtSecret 盐） */
function hashCode(code: string): string {
  const secret = useRuntimeConfig().jwtSecret
  return createHash('sha256')
    .update(code.toLowerCase() + secret)
    .digest('hex')
}

/** 手搓验证码 SVG（字符轻微旋转 + 随机色 + 3 条干扰线，纯字符串拼接） */
function renderSvg(code: string): string {
  const width = 120
  const height = 40
  const chars = code
    .split('')
    .map((ch, i) => {
      const x = 15 + i * 26
      const y = randInt(26, 30)
      const rotate = randInt(-20, 20)
      const color = COLORS[randInt(0, COLORS.length - 1)]
      return `<text x="${x}" y="${y}" font-size="24" font-family="Arial,sans-serif" font-weight="bold" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`
    })
    .join('')
  let lines = ''
  for (let i = 0; i < 3; i++) {
    const color = COLORS[randInt(0, COLORS.length - 1)]
    lines += `<line x1="${randInt(0, width)}" y1="${randInt(0, height)}" x2="${randInt(0, width)}" y2="${randInt(0, height)}" stroke="${color}" stroke-width="1" opacity="0.6"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f2f3f5"/>${lines}${chars}</svg>`
}

/** 生成验证码：返回 SVG 图 + 签名 token */
export async function generateCaptcha(): Promise<{ svg: string; token: string }> {
  const code = randomCode()
  const svg = renderSvg(code)
  const token = await new SignJWT({ h: hashCode(code), purpose: 'captcha' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${CAPTCHA_TTL_SEC}s`)
    .setIssuer('Nuxt4Demo')
    .sign(getSecret())
  return { svg, token }
}

/**
 * 校验验证码：token 合法且未过期、答案哈希匹配则通过。
 * token 缺失/过期/篡改、输入为空或任何异常均返回 false（绝不抛异常）。
 */
export async function verifyCaptcha(token: string, input: string): Promise<boolean> {
  if (!token || !input) return false
  try {
    const { payload } = await jwtVerify<{ h?: string; purpose?: string }>(token, getSecret())
    if (payload.purpose !== 'captcha' || typeof payload.h !== 'string') return false
    return payload.h === hashCode(input)
  } catch {
    return false
  }
}
