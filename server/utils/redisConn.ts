// server/utils/redisConn.ts
// Redis 连接基建（P0，D5/D17）：懒初始化单例 + 优雅降级，P1（configStore）/P2（rateStore）/
// P3（queueStore）三模块的公共地基。
//
// 语义（设计方案 §3.3 / §9.5）：
// - 未配置（runtimeConfig redis.host 为空）→ getRedis() 返回 null、不建连；一条 redis_unconfigured
//   告警（每进程生命周期仅一条）+ logger 提示。
// - 连接中/断连（isReady=false）→ getRedis() 返回 null：调用方回落内存 Adapter，不阻塞、不等待重连。
// - 连接失败/运行中断连（error/end）→ 降级 + 一条 redis_unavailable 告警；重连成功（ready）→ 自动恢复
//   + 一条 redis_recovered 告警。均为状态跃迁才写（防刷屏）。
// - ifAvailable(fn)：不可用直接 null；命令抛错 logger 留痕后返回 null，不向调用方抛错（降级不拖慢请求、不 500）。
// - 安全：密码仅经 runtimeConfig 注入，任何日志/告警/错误消息中禁止出现密码。
import { createClient } from 'redis'
import { logger } from '#shared/utils/logger'
import { logAlertEvent } from '#server/utils/alertEventLog'

type RedisClient = ReturnType<typeof createClient>

/** 故障快速失败：连接超时（设计范围 1000~2000 取上限） */
const CONNECT_TIMEOUT_MS = 2_000
/** 重连退避：500ms 起步指数递增，封顶 30s，持续重试不放弃 */
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 30_000

/** 连接健康态（仅用于告警跃迁判定；对调用方的可用性以 client.isReady 为准） */
type RedisHealthState = 'ok' | 'down'

let client: RedisClient | null = null
let initStarted = false
let healthState: RedisHealthState = 'ok'

/** 错误消息脱敏：仅取 message 并截断（不落堆栈，防底层错误意外携带连接信息） */
function safeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.slice(0, 200)
}

/** 状态跃迁写 redis_health 告警 + logger（同态重复事件不刷屏） */
function reportTransition(next: RedisHealthState, err?: unknown): void {
  if (healthState === next) return
  const from = healthState
  healthState = next
  if (next === 'down') {
    const reason = safeErrorMessage(err)
    logger.error(`[redis] 连接不可用，已降级（回落内存态，后台按退避策略持续重连）：${reason}`)
    logAlertEvent({
      source: 'redis_health',
      level: 'error',
      code: 'redis_unavailable',
      message: `Redis 连接不可用，已降级回落内存态：${reason}`,
      context: { from },
    })
  } else {
    logger.info('[redis] 连接恢复，自动切回')
    logAlertEvent({
      source: 'redis_health',
      level: 'warn',
      code: 'redis_recovered',
      message: 'Redis 连接恢复，自动切回',
      context: { from },
    })
  }
}

/** 懒初始化（首次调用 getRedis() 时执行一次；runtimeConfig 此时才读取，非 import 期） */
function init(): void {
  initStarted = true
  const cfg = useRuntimeConfig().redis
  if (!cfg?.host) {
    logger.info('[redis] 未配置 NUXT_REDIS_HOST，跳过连接（内存态运行）')
    logAlertEvent({
      source: 'redis_health',
      level: 'warn',
      code: 'redis_unconfigured',
      message: 'Redis 未配置（NUXT_REDIS_HOST 为空），以内存态运行',
    })
    return
  }

  client = createClient({
    socket: {
      host: cfg.host,
      port: Number(cfg.port) || 6379,
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy(retries: number) {
        return Math.min(RECONNECT_BASE_MS * 2 ** retries, RECONNECT_MAX_MS)
      },
    },
    password: cfg.password || undefined,
  })

  client.on('ready', () => {
    logger.info('[redis] 连接就绪')
    reportTransition('ok')
  })
  client.on('error', (err) => {
    reportTransition('down', err)
  })
  client.on('end', () => {
    reportTransition('down', new Error('connection ended'))
  })

  // 初连失败不放弃：node-redis 按 reconnectStrategy 在后台持续重试，
  // 此处仅置降级标记（getRedis() 返回 null），恢复由 ready 事件自动切回。
  client.connect().catch((err) => {
    reportTransition('down', err)
  })
}

/**
 * 获取 Redis 客户端（同步、非阻塞）：
 * 未配置 / 连接中 / 断连 → null（调用方回落内存 Adapter，不等待重连）；就绪 → 客户端单例。
 */
export function getRedis(): RedisClient | null {
  if (!initStarted) init()
  return client?.isReady ? client : null
}

/**
 * 可用则执行 fn 并返回其结果；不可用或命令抛错 → 返回 null（不向调用方抛错，降级不拖慢请求）。
 */
export async function ifAvailable<T>(fn: (client: RedisClient) => Promise<T>): Promise<T | null> {
  const c = getRedis()
  if (!c) return null
  try {
    return await fn(c)
  } catch (err) {
    logger.warn(`[redis] 命令执行失败（回落 null）：${safeErrorMessage(err)}`)
    return null
  }
}

/** 优雅断开（Nitro close 钩子调用；未初始化/已断开为 no-op） */
export async function closeRedis(): Promise<void> {
  if (!client) return
  const c = client
  client = null
  try {
    await c.disconnect()
  } catch (err) {
    logger.warn(`[redis] 关闭连接异常（忽略）：${safeErrorMessage(err)}`)
  }
}
