// server/utils/redis/pubsub.ts
// Redis Pub/Sub 基建（P4）：跨实例失效事件广播（permission 缓存失效等）。
//
// 语义（P4 跨实例失效方案）：
// - 通道名经 buildChannel() 构造：ep:{env}:{name}（env 前缀与 redisKey 一致，dev/prod 实例天然隔离）。
// - publish：动态 import redisConn（消解循环依赖 + 避免测试静态加载真实 redis 包，queueStore 先例）；
//   Redis 不可用/命令失败 → 静默降级（仅 logger.warn），绝不向调用方抛错（保持本地失效现状语义）。
// - subscribe：handler 先注册到模块级 Map（不触网）；懒建订阅客户端（main.duplicate() + connect），
//   Redis 不可用则保持未连接，下次 publish/subscribe 时重试（懒连接不阻塞模块加载）。
//   注：node-redis 断线重连后会自动重订阅已注册通道，无需手动恢复。
import { redisEnv } from '#server/utils/redis/keys'
import { logger } from '#shared/utils/logger'

type RedisConnModule = typeof import('#server/utils/redisConn')
/** 就绪的 Redis 客户端类型（订阅客户端为 main.duplicate()，同型） */
type ReadyRedisClient = NonNullable<ReturnType<RedisConnModule['getRedis']>>

/** 订阅回调：收到某通道消息时执行（payload 为解析后的对象，毒消息为 {}） */
type PubSubHandler = (payload: Record<string, unknown>) => void

/** 通道 → 处理器集合（模块级注册表，注册不触网；ensureSubscriber 成功后统一订阅） */
const handlers = new Map<string, Set<PubSubHandler>>()

/** 懒订阅客户端（main 的 duplicate；未配置/断连时为 null，下次触发时重试） */
let subClient: ReadyRedisClient | null = null

/** 订阅自愈：建立失败后的指数退避定时重试（初始 2s、*2 递增、封顶 30s，成功即停止） */
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 30_000
/** 当前退避间隔（初始化到基值；成功建立订阅后重置） */
let retryDelayMs = RETRY_BASE_MS
/** 待触发的自愈定时器句柄（null = 无挂起重试） */
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** 取消挂起的自愈重试（成功建立订阅时调用，防泄漏） */
function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  retryDelayMs = RETRY_BASE_MS
}

/** 安排一次指数退避重试（幂等：已有挂起定时器则不重复建） */
function scheduleRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void ensureSubscriber()
  }, retryDelayMs)
  // 更新下一轮退避间隔（封顶）；unref 防模块被卸载/进程退出时挂起
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS)
  retryTimer.unref?.()
}

/** 错误消息脱敏：仅取 message（与 redisConn/queueStore 口径一致） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** JSON.parse 安全解析：失败返回空对象（毒消息不抛、不打断订阅流） */
function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 通道名构造：ep:{env}:{name}（env 前缀与 key 规范一致，dev/prod 实例订阅互不串扰）。
 */
export function buildChannel(name: string): string {
  return `ep:${redisEnv()}:${name}`
}

/**
 * 发布事件：Redis 可用 → PUBLISH JSON 消息；不可用/命令失败 → 静默降级（仅 warn，不向调用方抛错）。
 */
export async function publish(channel: string, payload: unknown): Promise<void> {
  try {
    const { getRedis } = await import('#server/utils/redisConn')
    const client = getRedis()
    if (!client) return // 未配置/断连：本地失效已足够，跳过广播
    await client.publish(channel, JSON.stringify(payload))
  } catch (err) {
    logger.warn(`[pubsub] 发布失败（忽略）：${errorMessage(err)}`)
  }
}

/**
 * 懒建订阅客户端：main.duplicate() + connect，连接成功后对每个已注册通道 subscribe。
 * 取主客户端单独 try/catch：未配置/断连（含测试环境无 useRuntimeConfig 抛错）一律视为
 * Redis 不可用 → 静默保持未连接（redisConn 自身已写 redis_health 告警，不在此刷日志）；
 * 仅 duplicate/connect 等真实连接错误才 logger.warn（此时主客户端可用，logger 必可用）。
 */
async function ensureSubscriber(): Promise<void> {
  if (subClient) {
    clearRetry()
    return
  }
  let main: ReadyRedisClient | null
  try {
    const { getRedis } = await import('#server/utils/redisConn')
    main = getRedis()
  } catch {
    scheduleRetry() // 未配置/断连（含测试环境无 runtimeConfig），按退避重试，下次触发再建连
    return
  }
  if (!main) {
    // 主客户端已存在但未就绪（连接中/短暂断连）：保持未连接，指数退避重试等待就绪
    scheduleRetry()
    return
  }
  try {
    const sub = main.duplicate()
    // duplicate 继承 error 处理，仍挂 noop 防意外未处理错误噪音
    sub.on('error', () => {})
    await sub.connect()
    // 连接成功后订阅当前全部已注册通道（node-redis 重连后自动重订阅，无需手动恢复）
    const channels = [...handlers.keys()]
    if (channels.length > 0) {
      await sub.subscribe(channels, (message, channel) => {
        const payload = safeParse(message)
        handlers.get(channel)?.forEach((h) => h(payload))
      })
    }
    subClient = sub
    clearRetry() // 建立成功：取消并重置退避定时器
  } catch (err) {
    logger.warn(`[pubsub] 订阅连接失败（保持未连接，后续重试）：${errorMessage(err)}`)
    scheduleRetry()
  }
}

/**
 * 注册通道处理器（不触网）：先登记到模块级 Map，再懒触发订阅连接。
 */
export function subscribe(channel: string, handler: PubSubHandler): void {
  let set = handlers.get(channel)
  if (!set) {
    set = new Set()
    handlers.set(channel, set)
  }
  set.add(handler)
  void ensureSubscriber()
}
