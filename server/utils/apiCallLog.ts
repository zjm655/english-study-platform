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
}

// ─── 内存队列 ────────────────────────────────────────

const BATCH_SIZE = 100
const FLUSH_INTERVAL_MS = 5000

let queue: ApiCallEntry[] = []
let timer: ReturnType<typeof setInterval> | null = null

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
    const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = batch.flatMap(e => [
      e.path, e.routePattern, e.method, e.statusCode,
      e.businessCode, e.durationMs, e.userId, e.ip,
    ])
    await query(
      `INSERT INTO api_call_log (path, route_pattern, method, status_code, business_code, duration_ms, user_id, ip)
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
  queue.push(entry)
  ensureTimer()
  if (queue.length >= BATCH_SIZE) {
    void flush()
  }
}

/** 进程退出前最后 flush（供 Nitro close 钩子调用） */
export async function flushApiCallLog(): Promise<void> {
  await flush()
}