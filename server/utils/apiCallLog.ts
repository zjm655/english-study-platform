// server/utils/apiCallLog.ts
// API 调用埋点写入：运营统计模块的数据源，记录全量 /api 请求。
//
// 批量写入模式：内存队列 + 定时 flush + 达到阈值立即 flush。
// 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程。
// 调用方以 fire-and-forget 方式调用，对请求延迟零影响。
import { query } from '#server/utils/db'

/** 单条埋点记录 */
export interface ApiCallEntry {
  path: string
  routePattern: string | null
  method: string
  statusCode: number
  businessCode: number | null
  durationMs: number
  userId: number | null
  ip: string | null
  /** 请求短 ID（与 logs/api 文件日志关联，实现 DB↔文件双向定位），未生成时为 null */
  requestId?: string | null
  /** 错误信息（error 钩子提取，截断 500），正常请求为 null */
  errorMessage?: string | null
  /** 错误堆栈（仅 5xx 记录，截断 4000，敏感路径跳过），其余为 null */
  errorStack?: string | null
}

// ─── 诊断字段截断 ────────────────────────────────────

/** error_message 列上限（与迁移 023 的 VARCHAR(500) 对齐） */
export const DIAG_MESSAGE_MAX = 500
/** error_stack 记录上限（列为 TEXT，此为写入约定上限） */
export const DIAG_STACK_MAX = 4000

const TRUNCATED_MARK = '...[truncated]'

/**
 * 截断诊断文本（纯函数）：超限截断并追加 '...[truncated]'，
 * 截断后总长不超过 max（保证不超出 DB 列宽），空值归一为 null。
 */
export function truncateDiag(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  if (text.length <= max) return text
  return text.slice(0, max - TRUNCATED_MARK.length) + TRUNCATED_MARK
}

// ─── 内存队列 ────────────────────────────────────────

const BATCH_SIZE = 100
const FLUSH_INTERVAL_MS = 5000
/** 队列软上限：超限时丢弃最旧条目，防止 DB 写入变慢时队列无界增长导致 OOM（埋点为旁路，可容忍丢弃） */
const MAX_QUEUE_SIZE = 10_000

const queue: ApiCallEntry[] = []
let timer: ReturnType<typeof setInterval> | null = null
/** 累计因超限丢弃的条数（用于告警） */
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
    const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = batch.flatMap((e) => [
      e.path,
      e.routePattern,
      e.method,
      e.statusCode,
      e.businessCode,
      e.durationMs,
      e.userId,
      e.ip,
      e.requestId ?? null,
      e.errorMessage ?? null,
      e.errorStack ?? null,
    ])
    await query(
      `INSERT INTO api_call_log (path, route_pattern, method, status_code, business_code, duration_ms, user_id, ip, request_id, error_message, error_stack)
       VALUES ${values}`,
      params,
    )
  } catch (err) {
    logger.error('[api call log] 批量写入失败:', err)
    // 静默丢弃本批数据，不重试
  }
}

/**
 * 写入一条 API 调用埋点（入队，不阻塞）。
 * 调用方以 fire-and-forget 方式调用：logApiCall({...})
 */
export function logApiCall(entry: ApiCallEntry): void {
  // 软上限保护：超限丢弃最旧条目，避免 DB 写入慢时队列无界增长导致 OOM
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
    droppedCount++
    if (droppedCount === 1 || droppedCount % 1000 === 0) {
      logger.warn(`[api call log] 队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条埋点`)
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
 * 循环 flush 直到清空——单次 flush 仅写一个批次（BATCH_SIZE），
 * 队列超过一个批次时若只调用一次会残留丢失。
 * flush 内失败会 splice 丢弃本批，故队列必然递减，不会死循环。
 */
export async function flushApiCallLog(): Promise<void> {
  while (queue.length > 0) {
    await flush()
  }
}

/** 只读探针：内存缓冲水位快照（供 GET /api/admin/monitor 观测，不暴露队列引用） */
export function getApiCallLogStats(): { size: number; maxSize: number; dropped: number } {
  return { size: queue.length, maxSize: MAX_QUEUE_SIZE, dropped: droppedCount }
}
