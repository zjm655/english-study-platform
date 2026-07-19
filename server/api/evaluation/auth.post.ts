/**
 * POST /api/evaluation/auth
 *
 * 获取阿里云智能科教平台评测鉴权凭证（warrantId）。
 * 服务端用 app_secret 向阿里云 auth API 签名换证，前端拿 warrantId 初始化 EngineEvaluat。
 *
 * 签名算法（PHP demo 翻译）：
 *   1. 参数 = { app_secret, appid, timestamp, user_client_ip, user_id }
 *   2. 按 key 字母序排序 → key=value&... 拼接
 *   3. 整体 MD5 → request_sign
 */

import crypto from 'node:crypto'
import { networkInterfaces } from 'node:os'

/**
 * 获取本机非回环 IPv4 地址
 * 当 getRequestIP 返回回环地址时，使用此地址作为 user_client_ip
 */
function getMachineIp(): string {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]
    if (!iface) continue
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address
      }
    }
  }
  return '127.0.0.1'
}

export default defineEventHandler(async (event): Promise<ResPayload<{
  warrantId: string
  applicationId: string
  expireAt: number
}>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const { aiContent } = useRuntimeConfig()
  const { appId, appSecret, authUrl } = aiContent

  if (!appId || !appSecret || !authUrl) {
    console.error('[evaluation auth] aiContent 配置不完整')
    return validateError('评测服务配置不完整', 500)
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  // 获取客户端 IP，若为回环地址则使用机器真实 IP
  const requestIp = getRequestIP(event, { xForwardedFor: true }) ?? ''
  const userClientIp = (requestIp && requestIp !== '127.0.0.1' && requestIp !== '::1' && requestIp !== '::ffff:127.0.0.1')
    ? requestIp
    : getMachineIp()

  if (process.dev) {
    console.log(`[evaluation auth] requestIp: "${requestIp}", 使用 IP: "${userClientIp}", userId: ${userId}`)
  }

  // ── 签名 ──
  // 参数按 key 字母序排列：app_secret, appid, timestamp, user_client_ip, user_id
  const signMap: Record<string, string> = {
    app_secret: appSecret,
    appid: appId,
    timestamp,
    user_client_ip: userClientIp,
    user_id: String(userId),
  }
  const signStr = Object.keys(signMap)
    .sort()
    .map((k) => `${k}=${signMap[k]}`)
    .join('&')
  const requestSign = crypto.createHash('md5').update(signStr, 'utf8').digest('hex')

  if (process.dev) {
    console.log('[evaluation auth] signStr:', signStr)
    console.log('[evaluation auth] requestSign:', requestSign)
  }

  // ── 请求阿里云鉴权接口 ──
  try {
    const body = new URLSearchParams({
      appid: appId,
      timestamp,
      user_id: String(userId),
      user_client_ip: userClientIp,
      request_sign: requestSign,
      warrant_available: '300', // 5 分钟有效期
    })

    const resp = await $fetch<{
      code: number
      message: string
      data: {
        warrant_id: string
        expire_at: number
        timestamp: string
      }
    }>(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (resp.code !== 0) {
      console.error('[evaluation auth] 阿里云返回错误:', resp)
      return validateError(resp.message || '获取评测授权失败', 502)
    }

    return validateSuccess({
      warrantId: resp.data.warrant_id,
      applicationId: appId,
      expireAt: resp.data.expire_at,
    })
  } catch (err) {
    console.error('[evaluation auth] 请求阿里云鉴权接口失败:', err)
    return validateError('评测授权服务暂时不可用', 502)
  }
})
