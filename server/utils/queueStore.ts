// server/utils/queueStore.ts
// 埋点队列双 Adapter 基建（P3，D-P3-3/D-P3-5）：Redis 可用走 STREAM（XADD 入队 + 消费组
// cg-writer 定时批量落库，缓冲跨重启持久）；不可用/未配置/命令失败自动降级内存数组
// （软上限丢最旧 + onDrop 节流，batchQueue 现状语义），恢复后内存残留由 drain 直接落库
// （不并入 stream）。调用方只管业务（buildSql/enrich/onDrop），进出 Redis 一律在本模块。
//
// 语义（spec add-redis-queue-store）：
// - push：enrich 后 Redis 可用 → XADD（key 经 redisKey('q', namespace)，MAXLEN ~10000 兜底
//   裁剪，payload 单字段 p=JSON）；XADD 失败 catch 降级内存数组（warn 留痕）；不可用 → 内存数组。
// - 消费（timer 于 createQueue 注册时即启动、unref、默认 5s）：每轮先 drain 内存数组 → 再
//   XGROUP CREATE cg-writer MKSTREAM 幂等初始化（BUSYGROUP 忽略）→ XREADGROUP 先 "0"（自己
//   pending，重启恢复）后 ">"（新消息）各 COUNT batchSize → buildSql 批量 INSERT → 逐条
//   XACK+XDEL（INSERT 失败也出队=失败即丢 D-P3-2；JSON.parse 毒消息同样丢弃留痕）。
// - flushAll（close 钩子）：drain 内存 + 循环消费 stream 至空（≤20 轮防死循环）。
// - getStats：内存语义 {size, maxSize, dropped}（Redis 激活时 size 通常 0），monitor API 零改动。
// - 循环依赖规避（queueStore→redisConn→alertEventLog→queueStore）：redisConn 一律动态 import
//   （serviceQueue 先例）；warm 后 push 路径经缓存的 getRedis 引用同步判活，冷窗口
//   （进程启动瞬间动态加载未完成）的 push 一律走内存，由后续 drain 落库。
import { query } from '#server/utils/db'
import { redisKey } from '#server/utils/redis/keys'
import { logger } from '#shared/utils/logger'

/** 消费组名（spec D-P3-5：全队列统一） */
const CONSUMER_GROUP = 'cg-writer'
/** 稳定消费者名（单实例；重启后仍能读回自己 pending，实现重启恢复） */
const CONSUMER_NAME = 'w1'
/** XADD 兜底裁剪阈值（MAXLEN ~ 近似裁剪，防洪峰撑爆 stream；精确清理靠消费后 XDEL） */
const XADD_TRIM_THRESHOLD = 10_000
/** flushAll 循环消费 stream 的轮数上限（防死循环） */
const FLUSH_ALL_MAX_ROUNDS = 20
/** 丢弃回调节流节奏（与 batchQueue 历史行为一致：首次 + 每 1000 条） */
const DROP_REPORT_EVERY = 1000

export interface QueueStoreOptions<T> {
  /** 命名空间（与真实表名对齐：api_call_log / cloud_service_call_log / alert_event） */
  namespace: string
  /** 每批写入条数 */
  batchSize: number
  /** 定时消费间隔（默认 5000ms） */
  flushIntervalMs?: number
  /** 内存降级队列软上限（默认 10000，超限丢最旧） */
  maxQueueSize?: number
  /** 构建批量 INSERT（返回 SQL 与参数；每批调用一次） */
  buildSql: (entries: T[]) => { sql: string; params: unknown[] }
  /** 入队时对 entry 的补充处理（如 requestId 自动填充；XADD/内存前执行） */
  enrich?: (entry: T) => void
  /** 内存软上限丢弃回调（droppedCount 为累计值；内部已按「首次 + 每 1000 条」节流） */
  onDrop?: (droppedCount: number) => void
  /** 写库失败日志前缀（默认 '[queue store] 批量写入失败:'） */
  errorLabel?: string
}

export interface QueueStore<T> {
  push: (entry: T) => void
  flushAll: () => Promise<void>
  getStats: () => { size: number; maxSize: number; dropped: number }
}

// ─── redisConn 动态加载（消解静态环，模块级单次）──────────────────────

type RedisConnModule = typeof import('#server/utils/redisConn')
type ReadyRedisClient = NonNullable<ReturnType<RedisConnModule['getRedis']>>

let getRedisFn: RedisConnModule['getRedis'] | null = null
let warmUpPromise: Promise<void> | null = null

/** 错误消息脱敏：仅取 message（不落堆栈，与 configStore/rateStore 口径一致） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** XGROUP CREATE 幂等判定：BUSYGROUP = 消费组已存在（预期内，忽略） */
function isBusyGroupError(err: unknown): boolean {
  return errorMessage(err).includes('BUSYGROUP')
}

/**
 * 动态加载 redisConn 并缓存 getRedis 引用（全模块单次；失败仅 warn 一次后永久内存降级，
 * promise 恒 resolve 不向调用方抛）。
 */
function ensureWarmUp(): Promise<void> {
  if (!warmUpPromise) {
    warmUpPromise = import('#server/utils/redisConn').then(
      (mod) => {
        getRedisFn = mod.getRedis
      },
      (err) => {
        logger.warn(
          `[queue store] redisConn 动态加载失败，队列永久走内存降级：${errorMessage(err)}`,
        )
      },
    )
  }
  return warmUpPromise
}

/** 同步取 Redis 客户端：未 warm / 未配置 / 断连 / 取用异常 → null（调用方走内存降级） */
function getRedisSync(): ReadyRedisClient | null {
  if (!getRedisFn) return null
  try {
    return getRedisFn()
  } catch {
    // 无 runtimeConfig 等环境（测试）下 getRedis() 内部初始化会抛：视同不可用
    return null
  }
}

/**
 * 创建双 Adapter 埋点队列：Redis STREAM 外置 + 内存降级（接口与 batchQueue 同构 + namespace）。
 */
export function createQueue<T>(options: QueueStoreOptions<T>): QueueStore<T> {
  const {
    namespace,
    batchSize,
    flushIntervalMs = 5000,
    maxQueueSize = 10_000,
    buildSql,
    enrich,
    onDrop,
    errorLabel = '[queue store] 批量写入失败:',
  } = options

  const streamKey = redisKey('q', namespace)
  /** 内存降级数组（Redis 不可用期间承载条目；恢复后由 drain 直接落库，不并入 stream） */
  const memoryQueue: T[] = []
  let droppedCount = 0

  // 消费 timer 注册即启动 + redisConn 预热（D-P3-5：懒启动会让重启后的 stream 存量
  // 在无新 push 时永不消费；unref 不阻止进程退出）
  void ensureWarmUp()
  const timer = setInterval(() => {
    void flush()
  }, flushIntervalMs)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }

  /** 内存入队：软上限丢最旧 + onDrop 节流 + 达 batchSize 立即 flush（batchQueue 现状语义） */
  function appendToMemory(entry: T): void {
    if (memoryQueue.length >= maxQueueSize) {
      memoryQueue.shift()
      droppedCount++
      if (onDrop && (droppedCount === 1 || droppedCount % DROP_REPORT_EVERY === 0)) {
        onDrop(droppedCount)
      }
    }
    memoryQueue.push(entry)
    if (memoryQueue.length >= batchSize) {
      void drainMemory()
    }
  }

  /** Redis 入队：XADD（MAXLEN ~ 兜底裁剪）；失败 catch 降级内存数组（warn 留痕） */
  async function xAddEntry(client: ReadyRedisClient, entry: T): Promise<void> {
    try {
      await client.xAdd(
        streamKey,
        '*',
        { p: JSON.stringify(entry) },
        {
          TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: XADD_TRIM_THRESHOLD },
        },
      )
    } catch (err) {
      logger.warn(`[queue store:${namespace}] XADD 失败，本条降级内存数组：${errorMessage(err)}`)
      appendToMemory(entry)
    }
  }

  /** 批量 INSERT（失败静默丢弃本批不重试——旁路原则，batchQueue 现状语义） */
  async function insertBatch(batch: T[]): Promise<void> {
    try {
      const { sql, params } = buildSql(batch)
      await query(sql, params)
    } catch (err) {
      logger.error(errorLabel, err)
    }
  }

  /** drain 内存数组：全量分批 INSERT（timer 每轮与 flushAll 都先走这里） */
  async function drainMemory(): Promise<void> {
    while (memoryQueue.length > 0) {
      const batch = memoryQueue.splice(0, batchSize)
      await insertBatch(batch)
    }
  }

  /**
   * 消费一轮 stream：XGROUP 幂等初始化 → XREADGROUP 先 "0"（自己 pending，重启恢复）后
   * ">"（新消息）各 COUNT batchSize → 批量 INSERT → 逐条 XACK+XDEL。
   * 返回本轮是否消费到消息（flushAll 据此循环至空）。
   */
  async function consumeStream(): Promise<boolean> {
    try {
      await ensureWarmUp()
      const client = getRedisSync()
      if (!client) return false
      try {
        await client.xGroupCreate(streamKey, CONSUMER_GROUP, '$', { MKSTREAM: true })
      } catch (err) {
        if (!isBusyGroupError(err)) throw err
      }
      let consumed = 0
      consumed += await consumeOnce(client, '0')
      consumed += await consumeOnce(client, '>')
      return consumed > 0
    } catch (err) {
      logger.warn(`[queue store:${namespace}] Redis 消费失败（本轮跳过）：${errorMessage(err)}`)
      return false
    }
  }

  /** 单次 XREADGROUP：读一批 → 解析（毒消息丢弃留痕）→ 批量 INSERT → 逐条 XACK+XDEL */
  async function consumeOnce(client: ReadyRedisClient, readId: '0' | '>'): Promise<number> {
    const res = await client.xReadGroup(
      CONSUMER_GROUP,
      CONSUMER_NAME,
      [{ key: streamKey, id: readId }],
      { COUNT: batchSize },
    )
    if (!res) return 0
    let count = 0
    for (const stream of res) {
      if (stream.messages.length === 0) continue
      count += stream.messages.length
      const entries: T[] = []
      for (const m of stream.messages) {
        const raw = m.message['p']
        if (raw === undefined) {
          logger.warn(`[queue store:${namespace}] 毒消息丢弃（缺少 p 字段）：id=${m.id}`)
          continue
        }
        try {
          entries.push(JSON.parse(raw) as T)
        } catch {
          logger.warn(`[queue store:${namespace}] 毒消息丢弃（JSON.parse 失败）：id=${m.id}`)
        }
      }
      if (entries.length > 0) await insertBatch(entries)
      // 无论 INSERT 成败、无论是否毒消息，逐条 XACK+XDEL（失败即丢 D-P3-2，消息出队不重试）
      for (const m of stream.messages) {
        await ackAndDel(client, m.id)
      }
    }
    return count
  }

  /** 消费后善后：逐条 XACK + XDEL；失败仅 warn（XACK 失败下轮 "0" 会重读，接受罕见重复行） */
  async function ackAndDel(client: ReadyRedisClient, id: string): Promise<void> {
    try {
      await client.xAck(streamKey, CONSUMER_GROUP, id)
      await client.xDel(streamKey, id)
    } catch (err) {
      logger.warn(
        `[queue store:${namespace}] XACK/XDEL 失败（可能重投或残留 stream）：${errorMessage(err)}`,
      )
    }
  }

  /** timer 每轮：先 drain 内存（outage 残留）→ 再消费 stream */
  async function flush(): Promise<void> {
    await drainMemory()
    await consumeStream()
  }

  return {
    push(entry: T): void {
      enrich?.(entry)
      const client = getRedisSync()
      if (client) {
        void xAddEntry(client, entry)
        return
      }
      appendToMemory(entry)
    },
    async flushAll(): Promise<void> {
      await drainMemory()
      // 循环消费 stream 至空（≤20 轮防死循环）
      for (let round = 0; round < FLUSH_ALL_MAX_ROUNDS; round++) {
        const consumed = await consumeStream()
        if (!consumed) break
      }
    },
    getStats(): { size: number; maxSize: number; dropped: number } {
      return { size: memoryQueue.length, maxSize: maxQueueSize, dropped: droppedCount }
    },
  }
}
