/**
 * 游客音频签名 URL 每日次数限流（server-only）
 *
 * 设计要点（仿 uploadLimitChecker）：
 * - 从 sys_config 读取 guest_daily_audio_limit（默认 20），运营可在管理端调整
 * - 内存计数（Map），按 guestKey + 当日日期维度计数，每日重置
 * - 配置缓存 5 分钟 TTL，避免每次查库
 * - 内存计数重启后重置（可接受，限流目的是控制成本而非精确计数）
 */
import { query } from '#server/utils/db'

/** 默认每日限次（与 029 迁移 seed 值一致） */
const DEFAULT_DAILY_LIMIT = 20

/** sys_config 配置键 */
const CONFIG_KEY = 'guest_daily_audio_limit'

/** 缓存 sys_config 中的限次配置 */
let cachedLimit: { value: number; expireAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/** 内存计数 Map：key = `${guestKey}:${YYYY-MM-DD}`, value = 已用次数 */
const usageMap = new Map<string, number>()

/** 最大跟踪条目数（防止内存无限增长） */
const MAX_ENTRIES = 50_000

/** 获取当日日期字符串 YYYY-MM-DD（使用 Date.now() 以便测试 mock） */
function todayKey(): string {
  const d = new Date(Date.now())
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取 sys_config 中的每日限次配置（带 5min 缓存） */
async function getDailyLimit(): Promise<number> {
  if (cachedLimit && Date.now() < cachedLimit.expireAt) {
    return cachedLimit.value
  }
  try {
    const rows = await query<{ config_value: string }>(
      `SELECT config_value FROM sys_config WHERE config_key = ?`,
      [CONFIG_KEY],
    )
    const raw = rows[0]?.config_value
    const parsed = parseInt(raw ?? '', 10)
    const value = isNaN(parsed) || parsed <= 0 ? DEFAULT_DAILY_LIMIT : parsed
    cachedLimit = { value, expireAt: Date.now() + CACHE_TTL }
    return value
  } catch {
    // 查询失败返回默认值，不阻塞业务
    return DEFAULT_DAILY_LIMIT
  }
}

/**
 * 检查游客今日音频获取次数是否超限。
 * 每次调用即计数 +1（不论后续签名是否成功），超限返回 false。
 */
export async function checkGuestAudioLimit(
  guestKey: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = await getDailyLimit()
  const key = `${guestKey}:${todayKey()}`

  // 容量上限保护：淘汰最旧键
  if (usageMap.size >= MAX_ENTRIES) {
    const oldest = usageMap.keys().next().value
    if (oldest !== undefined) usageMap.delete(oldest)
  }

  const used = usageMap.get(key) ?? 0
  if (used >= limit) {
    return { allowed: false, remaining: 0 }
  }

  // 计数 +1
  usageMap.set(key, used + 1)
  return { allowed: true, remaining: limit - used - 1 }
}

/** 使配置缓存失效（管理员修改 guest_daily_audio_limit 后调用） */
export function invalidateGuestAudioLimitCache(): void {
  cachedLimit = null
}

/** 只读探针：当前计数 Map 条目数 */
export function getGuestAudioLimitStats(): { trackedEntries: number } {
  return { trackedEntries: usageMap.size }
}
