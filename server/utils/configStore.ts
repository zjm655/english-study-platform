// server/utils/configStore.ts
// sys_config 读取收敛点（P1，D-P1-2）：双 Adapter 窄接口——
// Redis 可用走 MGET 批量读（10s 抖动 TTL，Cache-Aside）；不可用/未配置自动降级内存 Map（5min TTL）。
//
// 语义（spec add-redis-config-store + 设计方案 §4）：
// - miss 回源 MySQL（WHERE config_key IN ...），仅回填「实际存在的键」；DB 缺键不缓存不返回
//   （接受穿透，D-P1-6：sys_config 全量 seed、唯一写点 UPDATE、无 DELETE，缺键=异常态）。
// - invalidateSysConfig：经 ifAvailable DEL Redis 键（失败静默，靠 ≤10s TTL 自愈）+ 同步清内存键。
// - 并发 miss 不加 single-flight（与现状语义一致，YAGNI）；返回原始字符串 Map，parseBool 等语义
//   解析留在调用模块。
import { query } from '#server/utils/db'
import { getRedis, ifAvailable } from '#server/utils/redisConn'
import { redisKey, TTL } from '#server/utils/redis/keys'
import { logger } from '#shared/utils/logger'

/** 内存降级缓存 TTL：对齐替换前各模块 5min 本地缓存语义 */
const MEMORY_TTL_MS = 5 * 60 * 1000

/** 内存 Adapter 条目（模块级单例；Redis 不可用期间承载降级缓存） */
const memoryCache = new Map<string, { value: string; expiresAt: number }>()

/** 回源 MySQL：只查给定键，返回原始 config_key → config_value Map（缺键自然不在其中） */
async function loadFromDb(keys: string[]): Promise<Map<string, string>> {
  const placeholders = keys.map(() => '?').join(', ')
  const rows = await query<{ config_key: string; config_value: string }>(
    `SELECT config_key, config_value FROM sys_config WHERE config_key IN (${placeholders})`,
    keys,
  )
  const result = new Map<string, string>()
  for (const r of rows) result.set(r.config_key, r.config_value)
  return result
}

/** Redis 读路径：MGET 批量读 → miss 回源 → 存在键 SET EX 回填（抖动 TTL） */
async function loadFromRedis(
  client: NonNullable<ReturnType<typeof getRedis>>,
  keys: string[],
): Promise<Map<string, string>> {
  const values = await client.mGet(keys.map((k) => redisKey('cfg', k)))
  const result = new Map<string, string>()
  const missKeys: string[] = []
  keys.forEach((k, i) => {
    // noUncheckedIndexedAccess 下越界为 undefined，与 null 同视为 miss（回源兜底）
    const v = values[i] ?? null
    if (v !== null) result.set(k, v)
    else missKeys.push(k)
  })
  if (missKeys.length === 0) return result

  const fromDb = await loadFromDb(missKeys)
  // 回填仅实际存在的键（Promise.all 逐键并发；单键失败不阻塞结果返回）
  await Promise.all(
    [...fromDb.entries()].map(([k, v]) =>
      client.set(redisKey('cfg', k), v, { EX: TTL.CONFIG_CACHE() }),
    ),
  )
  for (const [k, v] of fromDb) result.set(k, v)
  return result
}

/** 内存读路径：TTL 内命中直接返回；miss（或过期）回源 MySQL 后回填内存 */
async function loadFromMemory(keys: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const result = new Map<string, string>()
  const missKeys: string[] = []
  for (const k of keys) {
    const hit = memoryCache.get(k)
    if (hit && hit.expiresAt > now) result.set(k, hit.value)
    else missKeys.push(k)
  }
  if (missKeys.length === 0) return result

  const fromDb = await loadFromDb(missKeys)
  for (const [k, v] of fromDb) {
    memoryCache.set(k, { value: v, expiresAt: now + MEMORY_TTL_MS })
    result.set(k, v)
  }
  return result
}

/**
 * 批量读取 sys_config（窄接口）：Redis MGET 命中优先，miss 回源 MySQL 并回填；
 * Redis 不可用/命令失败降级内存 Map（5min）；返回原始字符串 Map（缺键不在其中，调用方走默认值）。
 */
export async function getSysConfigKeys(keys: string[]): Promise<Map<string, string>> {
  const client = getRedis()
  if (client) {
    try {
      return await loadFromRedis(client, keys)
    } catch (err) {
      // Redis 命令失败：降级 DB 直读（本次不缓存），不阻塞请求
      logger.warn(
        `[configStore] Redis 读配置失败，本次直读 DB：${err instanceof Error ? err.message : String(err)}`,
      )
      return await loadFromDb(keys)
    }
  }
  return await loadFromMemory(keys)
}

/**
 * 失效单个配置键：DEL Redis 键（经 ifAvailable，失败静默靠 ≤10s TTL 自愈）+ 同步清内存缓存键。
 */
export async function invalidateSysConfig(key: string): Promise<void> {
  memoryCache.delete(key)
  await ifAvailable((client) => client.del(redisKey('cfg', key)))
}
