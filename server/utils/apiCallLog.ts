// server/utils/apiCallLog.ts
// API 调用埋点写入：运营统计模块的数据源，记录全量 /api 请求。
//
// 批量写入模式（P3-I 重构）：队列逻辑统一收敛到 queueStore（Redis STREAM + 内存降级）；
// 本文件保留 entry 类型 / 诊断截断工具 / 对外导出名（调用方零改动）。
// 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程。
import { createQueue } from '#server/utils/queueStore'
import { logAlertEvent } from '#server/utils/alertEventLog'

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

// ─── 批量队列（P3-I：由 queueStore 统一实现（Redis STREAM + 内存降级））────────────

const BATCH_SIZE = 100
const MAX_QUEUE_SIZE = 10_000

const apiCallQueue = createQueue<ApiCallEntry>({
  namespace: 'api_call_log',
  batchSize: BATCH_SIZE,
  maxQueueSize: MAX_QUEUE_SIZE,
  errorLabel: '[api call log] 批量写入失败:',
  buildSql: (batch) => {
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
    return {
      sql: `INSERT INTO api_call_log (path, route_pattern, method, status_code, business_code, duration_ms, user_id, ip, request_id, error_message, error_stack)
       VALUES ${values}`,
      params,
    }
  },
  onDrop: (droppedCount) => {
    logger.warn(`[api call log] 队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条埋点`)
    // P1：丢弃事件落库（alert_event 为未来告警通道数据源）
    void logAlertEvent({
      source: 'log_queue',
      level: 'warn',
      code: 'log_queue_dropped',
      message: `api_call_log 埋点队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条`,
      context: { droppedCount },
    })
  },
})

/**
 * 写入一条 API 调用埋点（入队，不阻塞）。
 * 调用方以 fire-and-forget 方式调用：logApiCall({...})
 */
export function logApiCall(entry: ApiCallEntry): void {
  apiCallQueue.push(entry)
}

/** 进程退出前把队列全部写完（供 Nitro close 钩子调用）。 */
export async function flushApiCallLog(): Promise<void> {
  await apiCallQueue.flushAll()
}

/** 只读探针：内存缓冲水位快照（供 GET /api/admin/monitor 观测，不暴露队列引用） */
export function getApiCallLogStats(): { size: number; maxSize: number; dropped: number } {
  return apiCallQueue.getStats()
}
