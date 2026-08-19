// server/utils/rateStore.ts
// 限流/防爆破/游客计数统一固窗计数基建（P2，D-P2-2/D-P2-4）：双 Adapter 窄接口——
// Redis 可用走 INCR + 条件 EXPIRE + TTL 取剩余；不可用/未配置/命令失败自动降级内存 Map 镜像
// （不阻塞、不上抛；恢复后自动切回）。
//
// 语义（spec add-redis-rate-store）：
// - 固定窗口（D-P2-4）：内存 Adapter 是 Redis 固窗的 Map 镜像（count + expiresAt），双路径
//   零语义漂移；窗口到期计数归零重开（过期视 0 重计）。代价：限流边界突刺 ≤2×（D7 已接受）。
// - 被拒也计数（D-P2-2）：incrWindow 无条件自增后返回 count，由调用方拿 count 判定是否放行
//   （原子无竞态；攻击者持续消耗自身额度，防滥用语义更优）。
// - refreshTtl 模式：opts.refreshTtl=true 时每次自增都刷新窗口 TTL（fail 域防爆破用，保持
//   「最后一次失败后 N 分钟清零」现状语义）；默认仅 count===1（新窗口首计数）时种 TTL。
// - retryAfterSec = 窗口剩余秒数（Redis 路径取 TTL 命令返回；内存路径按 expiresAt 折算），
//   供调用方拒绝时作 Retry-After 提示。
// - key 一律经 redisKey(domain, id) 构造（调用方传 domain + id，不拼 key）；写入必带 TTL
//   （volatile-lru 淘汰前提）。
import { getRedis } from '#server/utils/redisConn'
import { redisKey } from '#server/utils/redis/keys'
import type { RedisDomain } from '#server/utils/redis/keys'
import { logger } from '#shared/utils/logger'

/** 内存 Adapter 条目：固窗计数 + 窗口到期时间戳（ms） */
interface MemoryEntry {
  count: number
  expiresAt: number
}

/** incrWindow 选项 */
export interface IncrWindowOptions {
  /** 每次自增都刷新窗口 TTL（fail 域防爆破：保持「最后一次失败后 N 分钟清零」语义） */
  refreshTtl?: boolean
}

/** incrWindow 返回 */
export interface IncrWindowResult {
  /** 自增后的当前窗口计数（被拒请求也计数，是否放行由调用方判定，D-P2-2） */
  count: number
  /** 窗口剩余秒数（拒绝时作 Retry-After 提示） */
  retryAfterSec: number
}

/** 内存 Adapter（模块级单例；Redis 不可用期间承载固窗计数镜像） */
const memoryMap = new Map<string, MemoryEntry>()

/** 内存软上限：对齐被替换四模块中最宽的现状防护（guest 域 50_000），防键泛洪撑爆内存 */
const MEMORY_MAX_ENTRIES = 50_000

/** 达到软上限时淘汰最早创建的键（FIFO），而非拒绝新键——避免键泛洪时误伤正常用户 */
function evictOldestIfFull(): void {
  if (memoryMap.size >= MEMORY_MAX_ENTRIES) {
    const oldestKey = memoryMap.keys().next().value
    if (oldestKey !== undefined) memoryMap.delete(oldestKey)
  }
}

/** 错误消息脱敏：仅取 message（不落堆栈，与 configStore/redisConn 口径一致） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 固定窗口计数自增（窄接口）：Redis INCR + 条件 EXPIRE + TTL 取剩余；
 * Redis 不可用或命令失败时降级内存 Map 镜像（同固窗语义，logger.warn 留痕不上抛）。
 */
export async function incrWindow(
  domain: RedisDomain,
  id: string,
  windowSec: number,
  opts?: IncrWindowOptions,
): Promise<IncrWindowResult> {
  const key = redisKey(domain, id)
  const client = getRedis()
  if (client) {
    try {
      const count = await client.incr(key)
      // 默认仅新窗口首计数（count===1）种 TTL；refreshTtl 模式每次刷新
      if (count === 1 || opts?.refreshTtl) {
        await client.expire(key, windowSec)
      }
      const ttl = await client.ttl(key)
      return { count, retryAfterSec: Math.max(0, ttl) }
    } catch (err) {
      // 命令失败：本次降级内存路径（不阻塞请求、不上抛；下次调用自动重试 Redis）
      logger.warn(`[rateStore] Redis 计数命令失败，本次降级内存路径：${errorMessage(err)}`)
    }
  }
  return incrMemory(key, windowSec, opts?.refreshTtl === true, Date.now())
}

/**
 * 读当前窗口计数（窄接口）：不存在/已过期 = 0，无副作用（不创建键、不续期）。
 */
export async function getCount(domain: RedisDomain, id: string): Promise<number> {
  const key = redisKey(domain, id)
  const client = getRedis()
  if (client) {
    try {
      const raw = await client.get(key)
      if (raw === null) return 0
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : 0
    } catch (err) {
      logger.warn(`[rateStore] Redis 读计数失败，本次降级内存路径：${errorMessage(err)}`)
    }
  }
  const entry = memoryMap.get(key)
  return entry && entry.expiresAt > Date.now() ? entry.count : 0
}

/**
 * 清零指定键（窄接口）：DEL Redis 键 + 同步删内存键（登录成功清零等场景）；失败仅 warn 不上抛。
 */
export async function resetKey(domain: RedisDomain, id: string): Promise<void> {
  const key = redisKey(domain, id)
  const client = getRedis()
  if (client) {
    try {
      await client.del(key)
    } catch (err) {
      logger.warn(`[rateStore] Redis 清零失败（仅清内存键）：${errorMessage(err)}`)
    }
  }
  // 内存键无条件删除：一并清理降级期残留（恢复后内存条目已作废）
  memoryMap.delete(key)
}

/** 只读探针：内存降级路径条目数，Redis 激活时为 0 属正常 */
export function getRateStoreStats(): { memoryEntries: number; memoryMaxEntries: number } {
  return { memoryEntries: memoryMap.size, memoryMaxEntries: MEMORY_MAX_ENTRIES }
}

/** 内存固窗自增：窗口内存活则 count+1（refreshTtl 时顺带续期），过期/不存在重开新窗口 */
function incrMemory(
  key: string,
  windowSec: number,
  refreshTtl: boolean,
  now: number,
): IncrWindowResult {
  const existing = memoryMap.get(key)
  let entry: MemoryEntry
  if (existing && existing.expiresAt > now) {
    existing.count += 1
    if (refreshTtl) existing.expiresAt = now + windowSec * 1000
    entry = existing
  } else {
    // 新窗口：过期条目被直接覆盖（天然清理）；插入新键前做软上限 FIFO 淘汰
    evictOldestIfFull()
    entry = { count: 1, expiresAt: now + windowSec * 1000 }
    memoryMap.set(key, entry)
  }
  return { count: entry.count, retryAfterSec: Math.ceil((entry.expiresAt - now) / 1000) }
}
