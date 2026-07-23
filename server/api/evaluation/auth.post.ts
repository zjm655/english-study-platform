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
import { serverFetch } from '#server/utils/request'
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

export default defineEventHandler(
  async (
    event,
  ): Promise<
    ResPayload<{
      warrantId: string
      applicationId: string
      expireAt: number
    }>
  > => {
    const userId = event.context.user?.id
    const userRole = event.context.user?.role ?? 0
    if (!userId) return validateError('未登录', 401)

    // 每日评测额度检查（在阿里云调用之前拦截，避免无效外部请求）
    const { checkDailyQuota } = await import('#server/utils/quotaChecker')
    const quota = await checkDailyQuota(userId, userRole)
    if (!quota.allowed) {
      return validateError(`今日评测次数已达上限（${quota.used}/${quota.limit}），明天再试吧`, 403)
    }

    const { aiContent } = useRuntimeConfig()
    const { appId, appSecret, authUrl } = aiContent

    if (!appId || !appSecret || !authUrl) {
      logger.error('[evaluation auth] aiContent 配置不完整')
      return validateError('评测服务配置不完整', 500)
    }

    const timestamp = Math.floor(Date.now() / 1000).toString()
    // 获取客户端 IP，若为回环地址则使用机器真实 IP
    const requestIp = getRequestIP(event, { xForwardedFor: true }) ?? ''
    const userClientIp =
      requestIp &&
      requestIp !== '127.0.0.1' &&
      requestIp !== '::1' &&
      requestIp !== '::ffff:127.0.0.1'
        ? requestIp
        : getMachineIp()

    if (import.meta.dev) {
      logger.log(
        `[evaluation auth] requestIp: "${requestIp}", 使用 IP: "${userClientIp}", userId: ${userId}`,
      )
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

    if (import.meta.dev) {
      logger.log('[evaluation auth] signStr:', signStr)
      logger.log('[evaluation auth] requestSign:', requestSign)
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

      const resp = await serverFetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        timeout: 30000,
        tag: '[evaluation auth]',
      })
      // serverFetch 透明返回原生 Response，非 2xx 不会抛异常，需显式检查
      if (!resp.ok) {
        logger.error('[evaluation auth] 阿里云 HTTP 错误:', resp.status)
        return validateError(`评测服务异常（${resp.status}）`, 502)
      }
      const respData = (await resp.json()) as {
        code: number
        message: string
        data: {
          warrant_id: string
          expire_at: number
          timestamp: string
        }
      }

      if (respData.code !== 0) {
        logger.error('[evaluation auth] 阿里云返回错误:', respData)
        return validateError(respData.message || '获取评测授权失败', 502)
      }

      return validateSuccess({
        warrantId: respData.data.warrant_id,
        applicationId: appId,
        expireAt: respData.data.expire_at,
      })
    } catch (err) {
      logger.error('[evaluation auth] 请求阿里云鉴权接口失败:', err)
      return validateError('评测授权服务暂时不可用', 502)
    }
  },
)
