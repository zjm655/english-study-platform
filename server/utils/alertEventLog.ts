// server/utils/alertEventLog.ts
// 告警事件写入：统一事件表 alert_event（可观测性事件数据源，未来告警通道立项后消费）。
//
// 批量写入模式（P3-I 重构）：内存队列逻辑统一收敛到 batchQueue 工厂；
// requestId 经请求上下文自动填充（getCurrentRequestId）。
// 事件源枚举单点收敛在 shared/utils/alertEvents.ts（P4-D2）。
import { createBatchQueue } from '#server/utils/batchQueue'
import { getCurrentRequestId } from '#server/utils/requestContext'
import type { AlertEventSource } from '#shared/utils/alertEvents'

export type { AlertEventSource }
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

// ─── 批量队列（P3-I：由 batchQueue 工厂统一实现）────────────

const BATCH_SIZE = 50
const MAX_QUEUE_SIZE = 10_000

const alertEventQueue = createBatchQueue<AlertEventEntry>({
  batchSize: BATCH_SIZE,
  maxQueueSize: MAX_QUEUE_SIZE,
  errorLabel: '[alert event] 批量写入失败:',
  enrich: (entry) => {
    // 请求上下文自动填充 requestId（显式传入优先；无上下文/后台路径为 null）
    entry.requestId = entry.requestId ?? getCurrentRequestId() ?? null
  },
  buildSql: (batch) => {
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
    return {
      sql: `INSERT INTO alert_event (source, level, code, message, request_id, user_id, context)
       VALUES ${values}`,
      params,
    }
  },
})

/**
 * 写入一条告警事件（入队，不阻塞）。
 * 调用方以 fire-and-forget 方式调用：void logAlertEvent({ ... })
 */
export function logAlertEvent(entry: AlertEventEntry): void {
  alertEventQueue.push(entry)
}

/**
 * 进程退出前把队列全部写完（供 Nitro close 钩子调用）。
 */
export async function flushAlertEventLog(): Promise<void> {
  await alertEventQueue.flushAll()
}

/** 只读探针：内存缓冲水位快照（供运行监控观测，不暴露队列引用） */
export function getAlertEventLogStats(): { size: number; maxSize: number; dropped: number } {
  return alertEventQueue.getStats()
}
