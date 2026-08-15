// server/utils/batchQueue.ts
// 批量写入队列工厂（P3-I）：统一「内存队列 + 定时 flush + 阈值立即 flush + 软上限丢最旧 +
// unref 定时器 + close flush + 只读探针」模式，消除 apiCallLog / cloudServiceLog / alertEventLog
// 三大 logger 的整文件同构重复。
//
// 约定：
// - push 入队（fire-and-forget 语义由调用方保持）；enrich 在入队时执行（如 requestId 自动填充）；
// - 软上限丢弃时 onDrop(droppedCount) 回调（写入 log_queue_dropped 事件等）；
// - flushAll 供 Nitro close 钩子调用；getStats 供运行监控探针。
import { query } from '#server/utils/db'
import { logger } from '#shared/utils/logger'

export interface BatchQueueOptions<T> {
  /** 每批写入条数 */
  batchSize: number
  /** 定时 flush 间隔（默认 5000ms） */
  flushIntervalMs?: number
  /** 队列软上限（默认 10000，超限丢最旧） */
  maxQueueSize?: number
  /** 构建批量 INSERT（返回 SQL 与参数；每批调用一次） */
  buildSql: (entries: T[]) => { sql: string; params: unknown[] }
  /** 入队时对 entry 的补充处理（如 requestId 自动填充） */
  enrich?: (entry: T) => void
  /** 软上限丢弃回调（droppedCount 为累计值；内部已按「首次 + 每 1000 条」节流） */
  onDrop?: (droppedCount: number) => void
  /** 写库失败日志前缀（默认 '[batch queue] 批量写入失败:'） */
  errorLabel?: string
}

export interface BatchQueue<T> {
  push: (entry: T) => void
  flushAll: () => Promise<void>
  getStats: () => { size: number; maxSize: number; dropped: number }
}

/** 丢弃回调节流节奏（与历史行为一致：首次 + 每 1000 条） */
const DROP_REPORT_EVERY = 1000

export function createBatchQueue<T>(options: BatchQueueOptions<T>): BatchQueue<T> {
  const {
    batchSize,
    flushIntervalMs = 5000,
    maxQueueSize = 10_000,
    buildSql,
    enrich,
    onDrop,
    errorLabel = '[batch queue] 批量写入失败:',
  } = options

  const queue: T[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let droppedCount = 0

  function ensureTimer(): void {
    if (timer !== null) return
    timer = setInterval(() => {
      void flush()
    }, flushIntervalMs)
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref() // 不阻止进程退出
    }
  }

  async function flush(): Promise<void> {
    if (queue.length === 0) return
    const batch = queue.splice(0, batchSize)
    try {
      const { sql, params } = buildSql(batch)
      await query(sql, params)
    } catch (err) {
      logger.error(errorLabel, err)
      // 静默丢弃本批数据，不重试（旁路原则）
    }
  }

  return {
    push(entry: T): void {
      enrich?.(entry)
      if (queue.length >= maxQueueSize) {
        queue.shift()
        droppedCount++
        if (onDrop && (droppedCount === 1 || droppedCount % DROP_REPORT_EVERY === 0)) {
          onDrop(droppedCount)
        }
      }
      queue.push(entry)
      ensureTimer()
      if (queue.length >= batchSize) {
        void flush()
      }
    },
    async flushAll(): Promise<void> {
      while (queue.length > 0) {
        await flush()
      }
    },
    getStats(): { size: number; maxSize: number; dropped: number } {
      return { size: queue.length, maxSize: maxQueueSize, dropped: droppedCount }
    },
  }
}
