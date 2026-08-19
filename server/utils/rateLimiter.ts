// server/utils/rateLimiter.ts
// 固定窗口限流器：每个 IP 按 route 分级限制请求频率
// 计数经 rateStore（Redis 固窗 + 内存降级镜像，D-P2-4）：被拒请求也计数（D-P2-2），
// retryAfter = 窗口剩余秒数；开关配置读取经 configStore（双 Adapter）

import { getSysConfigKeys } from '#server/utils/configStore'
import { incrWindow, getRateStoreStats } from '#server/utils/rateStore'

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
  '/api/guest/study-time': { windowMs: 60_000, maxRequests: 10 }, // 游客时长上报：IP 级防刷（正常 30s/次）
  '/api/guest/audio-url': { windowMs: 60_000, maxRequests: 30 }, // 游客音频签名：IP 级 30次/分钟
}

/** 登录/注册专用严格限流路径：防暴力破解 / 灌水，独立于全局 enabled 开关 */
const AUTH_PATHS = new Set(['/api/user/login', '/api/user/register'])
/** 登录/注册限流配置：10 次/分钟/IP */
const AUTH_CONFIG: RateLimitConfig = { windowMs: 60_000, maxRequests: 10 }

/** 限流开关默认值（全开，查询失败时回退到此） */
const DEFAULT_SWITCHES: RateLimitSwitches = {
  enabled: true,
  ipLevel: true,
  userLevel: true,
  uploadEnabled: true,
  uploadMax: 10,
  uploadWindow: 60,
}

/** 判断是否为上传材料路径（用户/管理员上传共用同一套独立限流配置） */
function isUploadPath(path: string): boolean {
  return path === '/api/segment/upload' || path === '/api/admin/segment/upload'
}

/** 限流键与档位匹配统一按 pathname（strip query）：
 *  防止随机 query 制造无限新桶绕过限流，并挤爆计数存储误伤正常用户 */
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

/** 读取限流开关配置（经 configStore 双 Adapter 批量读取，缓存语义由 configStore 承载；缺键走默认值） */
export async function getRateLimitConfig(): Promise<RateLimitSwitches> {
  try {
    const map = await getSysConfigKeys([
      'rate_limit_enabled',
      'rate_limit_ip_level',
      'rate_limit_user_level',
      'rate_limit_upload_enabled',
      'rate_limit_upload_max',
      'rate_limit_upload_window',
    ])
    // 缺键（DB 无此配置）时回退默认值，与读取失败同语义
    const parseBool = (key: string, def: boolean) => {
      const v = map.get(key)
      return v === undefined ? def : v === '1'
    }
    const parsePositiveInt = (key: string, def: number) => {
      const v = Number(map.get(key))
      return Number.isFinite(v) && v > 0 ? v : def
    }
    return {
      enabled: parseBool('rate_limit_enabled', DEFAULT_SWITCHES.enabled),
      ipLevel: parseBool('rate_limit_ip_level', DEFAULT_SWITCHES.ipLevel),
      userLevel: parseBool('rate_limit_user_level', DEFAULT_SWITCHES.userLevel),
      uploadEnabled: parseBool('rate_limit_upload_enabled', DEFAULT_SWITCHES.uploadEnabled),
      uploadMax: parsePositiveInt('rate_limit_upload_max', DEFAULT_SWITCHES.uploadMax),
      uploadWindow: parsePositiveInt('rate_limit_upload_window', DEFAULT_SWITCHES.uploadWindow),
    }
  } catch {
    // 读取失败时返回默认全开，不阻塞业务
    return DEFAULT_SWITCHES
  }
}

/**
 * 检查请求是否被限流（IP 级）
 * 上传路径的限流独立于全局 enabled 开关（由 uploadEnabled 控制）。
 * 计数经 rateStore 固定窗口：被拒请求也计数（incrWindow 无条件自增，D-P2-2），
 * retryAfter 取 incrWindow 返回的窗口剩余秒数。
 * @param ip   客户端 IP
 * @param path 请求路径
 * @param cfg  限流配置（含全局开关与上传独立配置）
 * @returns 是否允许 + 重试等待秒数
 */
export async function checkRateLimit(
  ip: string,
  path: string,
  cfg: RateLimitSwitches,
): Promise<RateLimitResult> {
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

  // IP 级限流键含 path，避免不同路径共享 counter（cross-path 污染）
  const id = `ip:${ip}:${path}`

  // 固窗计数（窗口秒数向上取整保证 ≥1）；超限时计数继续增长（防滥用语义）
  const { count, retryAfterSec } = await incrWindow('rl', id, Math.ceil(config.windowMs / 1000))
  if (count > config.maxRequests) {
    return { allowed: false, retryAfter: retryAfterSec }
  }
  return { allowed: true }
}

/**
 * 检查请求是否被限流（用户级）
 * 使用 user:{userId}@{ip}:{path} 组合键，避免同 IP 多用户、不同路径互相影响。
 * 上传路径的限流独立于全局 enabled 开关（由 uploadEnabled 控制）。
 * 计数经 rateStore 固定窗口：被拒请求也计数（incrWindow 无条件自增，D-P2-2），
 * retryAfter 取 incrWindow 返回的窗口剩余秒数。
 * @param ip     客户端 IP
 * @param path   请求路径
 * @param userId 用户 ID
 * @param cfg    限流配置（含全局开关与上传独立配置）
 * @returns 是否允许 + 重试等待秒数
 */
export async function checkUserRateLimit(
  ip: string,
  path: string,
  userId: number,
  cfg: RateLimitSwitches,
): Promise<RateLimitResult> {
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

  // 用户级限流键含 path，避免不同路径共享 counter（cross-path 污染）
  const id = `user:${userId}@${ip}:${path}`

  // 固窗计数（窗口秒数向上取整保证 ≥1）；超限时计数继续增长（防滥用语义）
  const { count, retryAfterSec } = await incrWindow('rl', id, Math.ceil(config.windowMs / 1000))
  if (count > config.maxRequests) {
    return { allowed: false, retryAfter: retryAfterSec }
  }
  return { allowed: true }
}

/**
 * 只读探针：限流计数水位快照（委托 rateStore 内存降级镜像的条目数与软上限；
 * Redis 激活时 trackedKeys=0 属正常。命名 trackedKeys 防误读为在线 IP 数）
 */
export function getRateLimiterStats(): { trackedKeys: number; maxEntries: number } {
  const { memoryEntries, memoryMaxEntries } = getRateStoreStats()
  return { trackedKeys: memoryEntries, maxEntries: memoryMaxEntries }
}
