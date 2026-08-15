// server/utils/alertEventLog.ts
// 告警事件写入：统一事件表 alert_event（可观测性事件数据源，未来告警通道立项后消费）。
//
// 设计要点（与 cloudServiceLog 同模式）：
// - 内存队列 + 定时 flush + 阈值立即 flush + 软上限丢最旧 + close 钩子 flush；
// - 失败静默吞错——旁路能力，绝不阻塞业务；
// - requestId 经请求上下文自动填充（getCurrentRequestId，无上下文为 null）。
// 事件源枚举：client_error（前端错误上报）/ log_queue（埋点队列丢弃）/ task_fail（任务失败）/
//            cloud_health（云服务健康事件，二期接入，枚举预留）。
import { query } from '#server/utils/db'
import { getCurrentRequestId } from '#server/utils/requestContext'
import { logger } from '#shared/utils/logger'

/** 事件来源（与迁移 037 alert_event.source 枚举一致；varchar 无 CHECK 约束，新增值无需迁移） */
export type AlertEventSource =
  'client_error' | 'log_queue' | 'task_fail' | 'cloud_health' | 'security'
/** 事件级别 */
export type AlertEventLevel = 'error' | 'warn'

/** 单条告警事件 */
export interface AlertEventEntry {
  source: AlertEventSource
  level?: AlertEventLevel
  /** 事件码：client_js_error / client_unhandledrejection / log_queue_dropped / task_fail 等 */
  code?: string | null
  /** 事件概要（写入时截 500） */
  message?: string | null
  /** 请求短 ID（8 位；经请求上下文自动填充，可显式覆盖） */
  requestId?: string | null
  userId?: number | null
  /** 结构化上下文（堆栈截断/队列名/任务 ID 等；不落敏感字段） */
  context?: Record<string, unknown> | null
}

// ─── 内存队列 ────────────────────────────────────────

const BATCH_SIZE = 50
const FLUSH_INTERVAL_MS = 5000
/** 队列软上限：超限丢弃最旧条目，防 DB 写入慢时队列无界增长导致 OOM（旁路，可容忍丢弃） */
const MAX_QUEUE_SIZE = 10_000

const queue: AlertEventEntry[] = []
let timer: ReturnType<typeof setInterval> | null = null
/** 累计因超限丢弃的条数（供运行监控探针） */
let droppedCount = 0

function ensureTimer(): void {
  if (timer !== null) return
  timer = setInterval(flush, FLUSH_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref() // 不阻止进程退出
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return
  const batch = queue.splice(0, BATCH_SIZE)
  try {
    const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = batch.flatMap((e) => [
      e.source,
      e.level ?? 'error',
      e.code ?? null,
      (e.message ?? '').slice(0, 500) || null, // 空串归一为 NULL
      e.requestId ?? null,
      e.userId ?? null,
      e.context ? JSON.stringify(e.context) : null,
    ])
    await query(
      `INSERT INTO alert_event (source, level, code, message, request_id, user_id, context)
       VALUES ${values}`,
      params,
    )
  } catch (err) {
    logger.error('[alert event] 批量写入失败:', err)
    // 静默丢弃本批数据，不重试
  }
}

/**
 * 写入一条告警事件（入队，不阻塞）。
 * 调用方以 fire-and-forget 方式调用：void logAlertEvent({ ... })
 */
export function logAlertEvent(entry: AlertEventEntry): void {
  // 请求上下文自动填充 requestId（显式传入优先；无上下文/后台路径为 null）
  entry.requestId = entry.requestId ?? getCurrentRequestId() ?? null
  // 软上限保护：超限丢弃最旧条目
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
    droppedCount++
    if (droppedCount === 1 || droppedCount % 1000 === 0) {
      logger.warn(`[alert event] 队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条事件`)
    }
  }
  queue.push(entry)
  ensureTimer()
  if (queue.length >= BATCH_SIZE) {
    void flush()
  }
}

/**
 * 进程退出前把队列全部写完（供 Nitro close 钩子调用）。
 * flush 内失败会 splice 丢弃本批，故队列必然递减，不会死循环。
 */
export async function flushAlertEventLog(): Promise<void> {
  while (queue.length > 0) {
    await flush()
  }
}

/** 只读探针：内存缓冲水位快照（供运行监控观测，不暴露队列引用） */
export function getAlertEventLogStats(): { size: number; maxSize: number; dropped: number } {
  return { size: queue.length, maxSize: MAX_QUEUE_SIZE, dropped: droppedCount }
}
