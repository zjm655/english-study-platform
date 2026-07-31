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
import { query } from '#server/utils/db'
import { networkInterfaces } from 'node:os'
import { readGuestKey } from '#server/utils/guest'
import { checkGuestEvalLimit, invalidateGuestEvalQuotaEntry } from '#server/utils/guestEvalLimit'

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
      userId: number
    }>
  > => {
    let userId = event.context.user?.id
    const userRole = event.context.user?.role ?? 0
    let isGuest = false
    // 游客身份变量，用于成功后清除配额缓存
    let guestKey: string | null = null
    let guestPhase: 'dubbing' | 'shadow' = 'dubbing'

    // 游客身份：无登录态时尝试从 guest_token 解析游客身份并检查配额
    if (!userId) {
      guestKey = await readGuestKey(event)
      if (!guestKey) return validateError('未登录', 401)

      // 从请求 body 读取 phase（前端传入 'dubbing' | 'shadow'）
      const body = await readBody(event).catch(() => ({})) as { phase?: string }
      guestPhase = body.phase === 'shadow' ? 'shadow' : 'dubbing'

      // 通过 guest_key 查到游客 user.id（评测引擎签名需要 userId）
      const userRows = await query<{ id: number }>(
        'SELECT id FROM user WHERE guest_key = ? LIMIT 1',
        [guestKey],
      )
      if (userRows.length === 0) {
        // 游客尚未实体化，不可能走到评测（需先有录音才能评测），兜底放行用虚拟 ID
        userId = 0
      } else {
        userId = userRows[0]!.id
      }

      // 游客评测配额检查（独立于登录用户的 eval_auth_log 额度体系）
      const evalLimit = await checkGuestEvalLimit(guestKey, guestPhase)
      if (!evalLimit.allowed) {
        return validateError('今日评测次数已用完，登录后可无限使用', 429)
      }
      isGuest = true
    }

    // 每日评测额度检查（仅登录用户，游客已在上方用 checkGuestEvalLimit 独立检查）
    if (!isGuest) {
      const { checkDailyQuota } = await import('#server/utils/quotaChecker')
      const quota = await checkDailyQuota(userId, userRole)
      if (!quota.allowed) {
        const windowDesc =
          quota.windowSec >= 86400
            ? `${Math.round(quota.windowSec / 86400)} 天`
            : quota.windowSec >= 3600
              ? `${Math.round(quota.windowSec / 3600)} 小时`
              : `${Math.round(quota.windowSec / 60)} 分钟`
        return validateError(
          `每 ${windowDesc}评测次数已达上限（${quota.used}/${quota.limit}），请稍后再试`,
          403,
        )
      }
    }

    // 全局评测并发闸门（拒绝型）：评测由前端 SDK 直连阿里云，无法服务端排队，
    // 超出并发估算阈值时直接拒绝，由用户稍后重试抢空闲名额（前端无自动重试，天然防惊群）
    const { checkEvalGate } = await import('#server/utils/quotaChecker')
    const gate = await checkEvalGate()
    if (!gate.allowed) {
      logger.warn(`[evaluation auth] 并发闸门拒绝：活跃估算 ${gate.active}/${gate.limit}`)
      return validateError('当前评测人数较多，请稍后重试', 503)
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

      // 记录本次评测鉴权发放（作为每日额度计数依据，fire-and-forget 不阻塞响应）。
      // 见 quotaChecker.checkDailyQuota：额度按 eval_auth_log 发放次数统计，
      // 从服务端侧堵死「不回写 analyze 即可绕过额度」的刷量问题。
      query('INSERT INTO eval_auth_log (user_id) VALUES (?)', [userId]).catch((err) => {
        logger.error('[evaluation auth] 记录鉴权发放失败:', err)
      })

      // 清除游客评测配额缓存，防止限流绕过
      if (guestKey) {
        invalidateGuestEvalQuotaEntry(guestKey, guestPhase)
      }

      return validateSuccess({
        warrantId: respData.data.warrant_id,
        applicationId: appId,
        expireAt: respData.data.expire_at,
        userId,
      })
    } catch (err) {
      logger.error('[evaluation auth] 请求阿里云鉴权接口失败:', err)
      return validateError('评测授权服务暂时不可用', 502)
    }
  },
)
