// server/utils/rateLimiter.ts
// 内存滑动窗口限流器：每个 IP 按 route 分级限制请求频率
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
  /** 上传材料限流开关（独立于 enabled） */
  uploadEnabled: boolean
  /** 上传材料窗口内最大请求数 */
  uploadMax: number
  /** 上传材料窗口秒数 */
  uploadWindow: number
}

/** 默认配置：60 次/分钟 */
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 60,
}

/**
 * 按路由前缀分级配置。
 * 上传路径（/api/segment/upload、/api/admin/segment/upload）由动态配置
 * rate_limit_upload_* 管理，不在此处硬编码。
 */
const ROUTE_CONFIGS: Record<string, RateLimitConfig> = {
  '/api/evaluation/auth': { windowMs: 60_000, maxRequests: 10 }, // 评测鉴权 10次/分钟
  '/api/admin': { windowMs: 60_000, maxRequests: 120 }, // 管理后台 120次/分钟
  '/api/oss/playback': { windowMs: 60_000, maxRequests: 300 }, // OSS 播放埋点：高频播放，宽松桶避免误伤
}

/** 登录/注册专用严格限流路径：防暴力破解 / 灌水，独立于全局 enabled 开关 */
const AUTH_PATHS = new Set(['/api/user/login', '/api/user/register'])
/** 登录/注册限流配置：10 次/分钟/IP */
const AUTH_CONFIG: RateLimitConfig = { windowMs: 60_000, maxRequests: 10 }

/** IP -> 时间戳数组 */
const windowMap = new Map<string, number[]>()

/** 最大跟踪 IP 数（防止内存无限增长） */
const MAX_ENTRIES = 10_000

/** 达到容量上限时淘汰最旧插入的键（FIFO 近似 LRU），而非拒绝新键——避免 IP 泛洪时误伤正常用户 */
function evictOldestIfFull(): void {
  if (windowMap.size >= MAX_ENTRIES) {
    const oldestKey = windowMap.keys().next().value
    if (oldestKey !== undefined) windowMap.delete(oldestKey)
  }
}

/** 定时清理间隔（每 5 分钟清理一次过期 IP） */
const CLEANUP_INTERVAL_MS = 5 * 60_000

/** 限流开关默认值（全开，查询失败时回退到此） */
const DEFAULT_SWITCHES: RateLimitSwitches = {
  enabled: true,
  ipLevel: true,
  userLevel: true,
  uploadEnabled: true,
  uploadMax: 10,
  uploadWindow: 60,
}

/** 缓存 sys_config 中的限流开关（TTL 5min） */
let cachedSwitches: { value: RateLimitSwitches; expireAt: number } | null = null
const SWITCH_CACHE_TTL = 5 * 60 * 1000

/** 判断是否为上传材料路径（用户/管理员上传共用同一套独立限流配置） */
function isUploadPath(path: string): boolean {
  return path === '/api/segment/upload' || path === '/api/admin/segment/upload'
}

/** 限流键与档位匹配统一按 pathname（strip query）：
 *  防止随机 query 制造无限新桶绕过滑窗限流，并挤爆 windowMap 误伤正常用户 */
function stripQuery(path: string): string {
  const i = path.indexOf('?')
  return i === -1 ? path : path.slice(0, i)
}

/** 判断是否为登录/注册路径（专用严格限流，独立于全局开关） */
function isAuthPath(path: string): boolean {
  return AUTH_PATHS.has(path)
}

/** 获取路径对应的限流配置。上传路径使用动态配置（rate_limit_upload_*） */
function getConfig(path: string, cfg: RateLimitSwitches): RateLimitConfig {
  // 上传路径：使用动态配置（独立于全局限流开关）
  if (isUploadPath(path)) {
    return { windowMs: cfg.uploadWindow * 1000, maxRequests: cfg.uploadMax }
  }
  // 登录/注册：专用严格档
  if (isAuthPath(path)) return AUTH_CONFIG
  // 精确匹配优先
  if (ROUTE_CONFIGS[path]) return ROUTE_CONFIGS[path]!
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
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN ('rate_limit_enabled', 'rate_limit_ip_level', 'rate_limit_user_level', 'rate_limit_upload_enabled', 'rate_limit_upload_max', 'rate_limit_upload_window')`,
    )
    const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
    const parseBool = (key: string) => map.get(key) === '1'
    const parsePositiveInt = (key: string, def: number) => {
      const v = Number(map.get(key))
      return Number.isFinite(v) && v > 0 ? v : def
    }
    const value: RateLimitSwitches = {
      enabled: parseBool('rate_limit_enabled'),
      ipLevel: parseBool('rate_limit_ip_level'),
      userLevel: parseBool('rate_limit_user_level'),
      uploadEnabled: parseBool('rate_limit_upload_enabled'),
      uploadMax: parsePositiveInt('rate_limit_upload_max', 10),
      uploadWindow: parsePositiveInt('rate_limit_upload_window', 60),
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
 * 上传路径的限流独立于全局 enabled 开关（由 uploadEnabled 控制）。
 * @param ip   客户端 IP
 * @param path 请求路径
 * @param cfg  限流配置（含全局开关与上传独立配置）
 * @returns 是否允许 + 重试等待秒数
 */
export function checkRateLimit(ip: string, path: string, cfg: RateLimitSwitches): RateLimitResult {
  // 限流口径按 endpoint（去 query）：event.path 含 query string
  path = stripQuery(path)
  // 上传路径：独立开关，不受全局 enabled 影响
  if (isUploadPath(path)) {
    if (!cfg.uploadEnabled) return { allowed: true }
  } else if (isAuthPath(path)) {
    // 登录/注册：始终启用严格限流（防暴力破解），不受全局 enabled/ipLevel 影响
  } else {
    // 非上传路径：受全局 enabled + ipLevel 控制
    if (!cfg.enabled || !cfg.ipLevel) return { allowed: true }
  }

  const config = getConfig(path, cfg)
  const now = Date.now()
  const windowStart = now - config.windowMs

  // IP 级限流键含 path，避免不同路径共享 counter（cross-path 污染）
  const key = `${ip}:${path}`

  // 获取或创建该键的时间戳数组
  let timestamps = windowMap.get(key)
  if (!timestamps) {
    // 容量上限保护：淘汰最旧键而非拒绝新键（避免 IP 泛洪时误伤正常用户）
    evictOldestIfFull()
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
 * 使用 userId@ip:path 组合键，避免同 IP 多用户、不同路径互相影响。
 * 上传路径的限流独立于全局 enabled 开关（由 uploadEnabled 控制）。
 * @param ip     客户端 IP
 * @param path   请求路径
 * @param userId 用户 ID
 * @param cfg    限流配置（含全局开关与上传独立配置）
 * @returns 是否允许 + 重试等待秒数
 */
export function checkUserRateLimit(
  ip: string,
  path: string,
  userId: number,
  cfg: RateLimitSwitches,
): RateLimitResult {
  // 限流口径按 endpoint（去 query）：event.path 含 query string
  path = stripQuery(path)
  // 上传路径：独立开关，不受全局 enabled 影响
  if (isUploadPath(path)) {
    if (!cfg.uploadEnabled) return { allowed: true }
  } else if (isAuthPath(path)) {
    // 登录/注册：始终启用严格限流（防暴力破解），不受全局 enabled/userLevel 影响
  } else {
    // 非上传路径：受全局 enabled + userLevel 控制
    if (!cfg.enabled || !cfg.userLevel) return { allowed: true }
  }

  const config = getConfig(path, cfg)
  const now = Date.now()
  const windowStart = now - config.windowMs

  // 用户级限流键含 path，避免不同路径共享 counter（cross-path 污染）
  const key = `${userId}@${ip}:${path}`

  // 获取或创建该键的时间戳数组
  let timestamps = windowMap.get(key)
  if (!timestamps) {
    // 容量上限保护：淘汰最旧键而非拒绝新键（避免 IP 泛洪时误伤正常用户）
    evictOldestIfFull()
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

/** 只读探针：限流滑窗水位快照（键为 ip:path 组合键，命名 trackedKeys 防误读为在线 IP 数） */
export function getRateLimiterStats(): { trackedKeys: number; maxEntries: number } {
  return { trackedKeys: windowMap.size, maxEntries: MAX_ENTRIES }
}
