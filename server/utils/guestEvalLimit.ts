/**
 * 游客评测配额检查（server-only）
 *
 * 设计要点（仿 uploadLimitChecker）：
 * - 从 sys_config 读取 guest_daily_eval_limit（默认 1），运营可调
 * - 计数方式：查 recording 表，按游客 user.id + 当日 + phase 维度统计
 * - 内存缓存（TTL 5min），避免每次评测请求都查库
 * - 查库异常兜底为放行（不阻断评测业务）
 */
import { query } from '#server/utils/db'
import type { RowDataPacket } from 'mysql2'

/** phase 编号与字符串标识的映射（recording 表 phase 列：3=配音，4=影子跟读） */
const PHASE_MAP = {
  dubbing: 3,
  shadow: 4,
} as const

/** 默认每日评测次数上限 */
const DEFAULT_DAILY_LIMIT = 1
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/** 缓存结构：按 guestKey:phase 粒度缓存 */
interface CacheEntry {
  used: number
  expireAt: number
}
const cache = new Map<string, CacheEntry>()

/** 最大缓存条目数（防止内存无限增长，仿 guestOssLimit 的 MAX_ENTRIES 模式） */
const MAX_CACHE_ENTRIES = 50_000

/** 达到容量上限时淘汰最旧插入的键（FIFO 近似 LRU） */
function evictIfFull(): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** 读取 sys_config 中的游客每日评测上限（带缓存） */
async function getGuestEvalLimit(): Promise<number> {
  // 复用全局缓存键，避免每次 check 都查 sys_config
  if (limitCache && Date.now() < limitCache.expireAt) return limitCache.value
  try {
    const rows = await query<{ config_value: string }>(
      "SELECT config_value FROM sys_config WHERE config_key = 'guest_daily_eval_limit'",
    )
    const raw = Number(rows[0]?.config_value)
    const value = !Number.isFinite(raw) || raw <= 0 ? DEFAULT_DAILY_LIMIT : Math.floor(raw)
    limitCache = { value, expireAt: Date.now() + CACHE_TTL }
    return value
  } catch {
    return DEFAULT_DAILY_LIMIT
  }
}

let limitCache: { value: number; expireAt: number } | null = null

/**
 * 检查游客评测配额。
 * @param guestKey 游客标识（guest_token 中的 gk）
 * @param phase 阶段标识：'dubbing'（配音）| 'shadow'（影子跟读）
 * @returns allowed 是否允许, remaining 剩余次数, used 已用次数, limit 上限
 */
export async function checkGuestEvalLimit(
  guestKey: string,
  phase: 'dubbing' | 'shadow',
): Promise<{ allowed: boolean; remaining: number; used: number; limit: number }> {
  const limit = await getGuestEvalLimit()
  const phaseNum = PHASE_MAP[phase]
  const cacheKey = `${guestKey}:${phase}`

  // 命中缓存
  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expireAt) {
    return { allowed: cached.used < limit, remaining: Math.max(0, limit - cached.used), used: cached.used, limit }
  }

  try {
    // 通过 guest_key 查到 user.id（排除已合并/已销号行，堵残留 token 绕过）
    const userRows = await query<{ id: number }>(
      'SELECT id FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL AND deleted_at IS NULL LIMIT 1',
      [guestKey],
    )
    if (userRows.length === 0) {
      // 游客尚未实体化（无 user 行），视为 0 次使用
      evictIfFull()
      cache.set(cacheKey, { used: 0, expireAt: Date.now() + CACHE_TTL })
      return { allowed: true, remaining: limit, used: 0, limit }
    }
    const userId = userRows[0]!.id

    // 统计当日该 phase 的成功评测数（analyze_status='success'，sargable 范围查询）
    const countRows = await query<{ cnt: number } & RowDataPacket>(
      `SELECT COUNT(*) AS cnt FROM recording
       WHERE user_id = ? AND phase = ? AND analyze_status = 'success'
         AND created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`,
      [userId, phaseNum],
    )
    const used = countRows[0]?.cnt ?? 0
    evictIfFull()
    cache.set(cacheKey, { used, expireAt: Date.now() + CACHE_TTL })
    return { allowed: used < limit, remaining: Math.max(0, limit - used), used, limit }
  } catch {
    // 查库失败兜底放行，不阻断评测业务
    return { allowed: true, remaining: limit, used: 0, limit }
  }
}

/**
 * 查询游客当日两种 phase 的配额状态（供前端配额查询接口使用）。
 */
export async function getGuestEvalQuota(
  guestKey: string,
): Promise<{ dubbing: { used: number; limit: number }; shadow: { used: number; limit: number } }> {
  const limit = await getGuestEvalLimit()

  try {
    const userRows = await query<{ id: number }>(
      'SELECT id FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL AND deleted_at IS NULL LIMIT 1',
      [guestKey],
    )
    if (userRows.length === 0) {
      return { dubbing: { used: 0, limit }, shadow: { used: 0, limit } }
    }
    const userId = userRows[0]!.id

    const countRows = await query<{ phase: number; cnt: number } & RowDataPacket>(
      `SELECT phase, COUNT(*) AS cnt FROM recording
       WHERE user_id = ? AND phase IN (?, ?) AND analyze_status = 'success'
         AND created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       GROUP BY phase`,
      [userId, PHASE_MAP.dubbing, PHASE_MAP.shadow],
    )

    const phaseCountMap = new Map(countRows.map((r) => [r.phase, r.cnt]))
    const dubbingUsed = phaseCountMap.get(PHASE_MAP.dubbing) ?? 0
    const shadowUsed = phaseCountMap.get(PHASE_MAP.shadow) ?? 0

    // 写入缓存
    evictIfFull()
    cache.set(`${guestKey}:dubbing`, { used: dubbingUsed, expireAt: Date.now() + CACHE_TTL })
    evictIfFull()
    cache.set(`${guestKey}:shadow`, { used: shadowUsed, expireAt: Date.now() + CACHE_TTL })

    return { dubbing: { used: dubbingUsed, limit }, shadow: { used: shadowUsed, limit } }
  } catch {
    return { dubbing: { used: 0, limit }, shadow: { used: 0, limit } }
  }
}

/** 使配额缓存失效（管理员修改配置或需要强制刷新时调用） */
export function invalidateGuestEvalLimitCache(): void {
  cache.clear()
  limitCache = null
}

/** 精确清除指定游客的评测配额缓存条目（评测成功后调用，防止限流绕过） */
export function invalidateGuestEvalQuotaEntry(guestKey: string, phase: 'dubbing' | 'shadow'): void {
  cache.delete(`${guestKey}:${phase}`)
}
