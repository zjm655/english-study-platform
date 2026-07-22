// server/utils/rateLimiter.ts
// 内存滑动窗口限流器：每个 IP 按路由模式分级限制请求频率
// 不引入 Redis，单机部署足够

import { query } from '#server/utils/db'

interface RateLimitConfig {
  /** 时间窗口（毫秒） */
  windowMs: number
  /** 窗口内最大请求数 */
  maxRequests: number
}

interface RateLimitResult {
  allowed: boolean
  /** 需要等待的秒数（仅 allowed=false 时有效） */
  retryAfter?: number
}

interface RateLimitSwitches {
  enabled: boolean
  ipLevel: boolean
  userLevel: boolean
}

/** 默认配置：60 次/分钟 */
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 60,
}

/** 按路由前缀分级配置 */
const ROUTE_CONFIGS: Record<string, RateLimitConfig> = {
  '/api/segment/upload': { windowMs: 60_000, maxRequests: 10 }, // 上传接口 10次/分钟
  '/api/admin/segment/upload': { windowMs: 60_000, maxRequests: 10 }, // 管理员上传 10次/分钟
  '/api/evaluation/auth': { windowMs: 60_000, maxRequests: 10 }, // 评测鉴权 10次/分钟
  '/api/admin': { windowMs: 60_000, maxRequests: 120 }, // 管理后台 120次/分钟
}

/** IP -> 时间戳数组 */
const windowMap = new Map<string, number[]>()

/** 最大跟踪 IP 数（防止内存无限增长） */
const MAX_ENTRIES = 10_000

/** 定时清理间隔（每 5 分钟清理一次过期 IP） */
const CLEANUP_INTERVAL_MS = 5 * 60_000

/** 限流开关默认值（全开，查询失败时回退到此） */
const DEFAULT_SWITCHES: RateLimitSwitches = {
  enabled: true,
  ipLevel: true,
  userLevel: true,
}

/** 缓存 sys_config 中的限流开关（TTL 5min） */
let cachedSwitches: { value: RateLimitSwitches; expireAt: number } | null = null
const SWITCH_CACHE_TTL = 5 * 60 * 1000

/** 获取 IP 对应的限流配置 */
function getConfig(path: string): RateLimitConfig {
  // 精确匹配优先
  if (ROUTE_CONFIGS[path]) return ROUTE_CONFIGS[path]
  // 前缀匹配（如 /api/admin/*）
  for (const [prefix, config] of Object.entries(ROUTE_CONFIGS)) {
    if (path.startsWith(prefix)) return config
  }
  return DEFAULT_CONFIG
}

/** 读取限流开关配置（带 5min 内存缓存，仿 quotaChecker 的 cachedLimit 模式） */
export async function getRateLimitConfig(): Promise<RateLimitSwitches> {
  if (cachedSwitches && Date.now() < cachedSwitches.expireAt) {
    return cachedSwitches.value
  }
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN ('rate_limit_enabled', 'rate_limit_ip_level', 'rate_limit_user_level')`,
    )
    const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
    const parse = (key: string) => map.get(key) === '1'
    const value: RateLimitSwitches = {
      enabled: parse('rate_limit_enabled'),
      ipLevel: parse('rate_limit_ip_level'),
      userLevel: parse('rate_limit_user_level'),
    }
    cachedSwitches = { value, expireAt: Date.now() + SWITCH_CACHE_TTL }
    return value
  } catch {
    // 查询失败时返回默认全开，不阻塞业务
    return DEFAULT_SWITCHES
  }
}

/** 使限流开关缓存失效（管理员修改配置后调用） */
export function invalidateRateLimitCache(): void {
  cachedSwitches = null
}

/**
 * 检查请求是否被限流（IP 级）
 * @param ip 客户端 IP
 * @param path 请求路径
 * @returns 是否允许 + 重试等待秒数
 */
export function checkRateLimit(ip: string, path: string): RateLimitResult {
  const config = getConfig(path)
  const now = Date.now()
  const windowStart = now - config.windowMs

  // IP 级限流键直接使用 ip
  const key = ip

  // 获取或创建该键的时间戳数组
  let timestamps = windowMap.get(key)
  if (!timestamps) {
    // 超过上限时拒绝新键（防止内存无限增长），已有键不受影响
    if (windowMap.size >= MAX_ENTRIES) {
      return { allowed: false, retryAfter: 60 }
    }
    timestamps = []
    windowMap.set(key, timestamps)
  }

  // 清除过期时间戳
  const valid = timestamps.filter((t) => t > windowStart)
  windowMap.set(key, valid)

  // 检查是否超限
  if (valid.length >= config.maxRequests) {
    const oldest = valid[0]!
    const retryAfterMs = oldest + config.windowMs - now
    return {
      allowed: false,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    }
  }

  // 记录当前请求
  valid.push(now)
  return { allowed: true }
}

/**
 * 检查请求是否被限流（用户级）
 * 使用 userId@ip 组合键，避免同 IP 多用户互相影响。
 * 注意：本函数不读取限流开关（开关在 auth 中间件判断）。
 * @param ip     客户端 IP
 * @param path   请求路径
 * @param userId 用户 ID
 * @returns 是否允许 + 重试等待秒数
 */
export function checkUserRateLimit(ip: string, path: string, userId: number): RateLimitResult {
  const config = getConfig(path)
  const now = Date.now()
  const windowStart = now - config.windowMs

  // 用户级限流键使用 userId@ip 组合
  const key = `${userId}@${ip}`

  // 获取或创建该键的时间戳数组
  let timestamps = windowMap.get(key)
  if (!timestamps) {
    // 超过上限时拒绝新键（防止内存无限增长），已有键不受影响
    if (windowMap.size >= MAX_ENTRIES) {
      return { allowed: false, retryAfter: 60 }
    }
    timestamps = []
    windowMap.set(key, timestamps)
  }

  // 清除过期时间戳
  const valid = timestamps.filter((t) => t > windowStart)
  windowMap.set(key, valid)

  // 检查是否超限
  if (valid.length >= config.maxRequests) {
    const oldest = valid[0]!
    const retryAfterMs = oldest + config.windowMs - now
    return {
      allowed: false,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    }
  }

  // 记录当前请求
  valid.push(now)
  return { allowed: true }
}

/** 定时清理：删除所有时间戳均已过期的 IP 条目 */
function cleanup() {
  const now = Date.now()
  // 用最宽松的窗口（DEFAULT_CONFIG）判断过期
  const threshold = now - DEFAULT_CONFIG.windowMs
  for (const [ip, timestamps] of windowMap.entries()) {
    const hasRecent = timestamps.some((t) => t > threshold)
    if (!hasRecent) {
      windowMap.delete(ip)
    }
  }
}

// 启动定时清理
if (typeof setInterval !== 'undefined') {
  setInterval(cleanup, CLEANUP_INTERVAL_MS)
}
