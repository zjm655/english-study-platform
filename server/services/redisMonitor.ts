// server/services/redisMonitor.ts
// Redis 健康监控（P4 后续可视化 Task 2）：读取 INFO 摘要 + SCAN/TTL 按域 key 统计，并入运行
// 监控聚合快照（GET /api/admin/monitor 的 redis 段）。
//
// 设计约定：
// - 快照只读、绝不抛错：Redis 未配置 / 未就绪 / 命令失败 → 返回 configured/online 降级态
//   （info/domains 为 null），不阻塞 monitor 聚合快照生成。
// - 动态 import redisConn（queueStore ensureWarmUp 先例）：消解循环依赖，且避免测试加载真实
//   redis 包（redisConn → alertEventLog → queueStore 链）；getRedis 在运行时才取。
// - 域统计口径：key 规范 ep:{env}:{domain}:{id}（redis/keys.ts），取第 3 段（index 2）为
//   domain（id 段可能含冒号，只取 index 2）；白名单 REDIS_DOMAIN（cfg/rl/fail/q/evt/lock/sem）
//   之外的前缀归入 'other' 分组，防止未知 key 淹没白名单统计。
// - TTL 语义：ttl>0 = 将过期（expiring）、ttl=-1 = 无 TTL（noTtl）、ttl=-2（扫描间隙已过期/
//   不存在）仅计入 keys，不计入 expiring/noTtl。
import { REDIS_DOMAIN } from '#server/utils/redis/keys'
import type {
  RedisMonitorStat,
  RedisInfoSummary,
  RedisDomainStat,
} from '#shared/types/adminMonitor'

/** 每次 SCAN 返回的 key 数（key 短小，全库通常个位数轮次） */
const SCAN_COUNT = 1000
/** SCAN 轮次上限（防死循环：cursor 恒非 '0' 时强制退出） */
const MAX_SCAN_ROUNDS = 1000

type RedisConnModule = typeof import('#server/utils/redisConn')
type RedisClient = NonNullable<ReturnType<RedisConnModule['getRedis']>>

/** 数值字段解析：缺失 / 空 / NaN → undefined（可选字段保持缺省） */
function toNumOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isNaN(n) ? undefined : n
}

/** 解析 INFO 文本（KEY:value 行，首个冒号分隔）为摘要对象；仅取监控相关字段，其余行忽略 */
function parseInfo(raw: string): RedisInfoSummary {
  const map = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    map.set(line.slice(0, idx), line.slice(idx + 1))
  }
  const info: RedisInfoSummary = {}
  const version = map.get('redis_version')
  if (version !== undefined) info.version = version
  info.usedMemoryBytes = toNumOrUndefined(map.get('used_memory'))
  info.maxMemoryBytes = toNumOrUndefined(map.get('maxmemory'))
  info.connectedClients = toNumOrUndefined(map.get('connected_clients'))
  info.rdbLastBgsaveAgoSec = toNumOrUndefined(map.get('rdb_last_bgsave_time_sec'))
  const rdbBgsaveInProgress = map.get('rdb_bgsave_in_progress')
  if (rdbBgsaveInProgress !== undefined) info.rdbBgsaveInProgress = rdbBgsaveInProgress === '1'
  return info
}

/** SCAN 全库 + 逐 key TTL，按 redisKey 域聚合统计（白名单外前缀归 'other'） */
async function scanDomains(client: RedisClient): Promise<Record<string, RedisDomainStat>> {
  const knownDomains = new Set<string>(REDIS_DOMAIN)
  const keys: string[] = []
  let cursor = '0'
  let rounds = 0
  do {
    const res = await client.scan(cursor, { COUNT: SCAN_COUNT })
    cursor = res.cursor
    keys.push(...res.keys)
    rounds++
  } while (cursor !== '0' && rounds < MAX_SCAN_ROUNDS)

  const statMap = new Map<string, RedisDomainStat>()
  for (const key of keys) {
    const rawTtl = await client.ttl(key)
    const domain = key.split(':')[2] ?? 'other'
    const name = knownDomains.has(domain) ? domain : 'other'
    let stat = statMap.get(name)
    if (!stat) {
      stat = { keys: 0, expiring: 0, noTtl: 0 }
      statMap.set(name, stat)
    }
    stat.keys++
    if (rawTtl > 0) {
      stat.expiring++
    } else if (rawTtl === -1) {
      stat.noTtl++
    }
  }
  return Object.fromEntries(statMap)
}

/**
 * 获取 Redis 健康状态（INFO 摘要 + 按域 key 统计），并入 monitor 聚合快照。
 * 任何异常（未配置 / 未就绪 / 命令失败）一律返回降级态、绝不抛错。
 */
export async function getRedisMonitorStat(): Promise<RedisMonitorStat> {
  const { getRedis } = await import('#server/utils/redisConn')

  let configured = false
  try {
    const cfg = useRuntimeConfig()?.redis
    configured = Boolean(cfg?.host)
  } catch {
    // 测试等无 useRuntimeConfig 环境：configured 保持初始 false（按未配置处理）
  }

  const client = getRedis()
  if (!client) {
    return { configured, online: false, info: null, domains: null }
  }

  try {
    const info = parseInfo(await client.info())
    const domains = await scanDomains(client)
    return { configured, online: true, info, domains }
  } catch {
    // Redis 命令失败（连接中断等）：降级不阻塞快照
    return { configured, online: false, info: null, domains: null }
  }
}
