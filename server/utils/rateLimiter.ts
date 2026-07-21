// server/utils/rateLimiter.ts
// 内存滑动窗口限流器：每个 IP 按路由模式分级限制请求频率
// 不引入 Redis，单机部署足够

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

/** 默认配置：60 次/分钟 */
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 60,
}

/** 按路由前缀分级配置 */
const ROUTE_CONFIGS: Record<string, RateLimitConfig> = {
  '/api/segment/upload': { windowMs: 60_000, maxRequests: 5 },       // 上传接口 5次/分钟
  '/api/admin/segment/upload': { windowMs: 60_000, maxRequests: 10 }, // 管理员上传 10次/分钟
  '/api/evaluation/auth': { windowMs: 60_000, maxRequests: 10 },     // 评测鉴权 10次/分钟
  '/api/admin': { windowMs: 60_000, maxRequests: 120 },               // 管理后台 120次/分钟
}

/** IP -> 时间戳数组 */
const windowMap = new Map<string, number[]>()

/** 定时清理间隔（每 5 分钟清理一次过期 IP） */
const CLEANUP_INTERVAL_MS = 5 * 60_000

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

/**
 * 检查请求是否被限流
 * @param ip 客户端 IP
 * @param path 请求路径
 * @returns 是否允许 + 重试等待秒数
 */
export function checkRateLimit(ip: string, path: string): RateLimitResult {
  const config = getConfig(path)
  const now = Date.now()
  const windowStart = now - config.windowMs

  // 获取或创建该 IP 的时间戳数组
  let timestamps = windowMap.get(ip)
  if (!timestamps) {
    timestamps = []
    windowMap.set(ip, timestamps)
  }

  // 清除过期时间戳
  const valid = timestamps.filter((t) => t > windowStart)
  windowMap.set(ip, valid)

  // 检查是否超限
  if (valid.length >= config.maxRequests) {
    const oldest = valid[0]
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