// server/utils/apiCallLog.ts
// API 调用埋点写入：运营统计模块的数据源，记录全量 /api 请求。
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

/**
 * 写入一条 API 调用埋点。
 *
 * 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程，仅记 logger.error。
 * 调用方以 fire-and-forget 方式调用（不 await），对请求延迟零影响。
 *
 * 未来如需批量写入（高流量场景），仅需改造本文件内部实现（内存队列 + 定时 flush），
 * 调用方接口不变。
 */
export async function logApiCall(entry: ApiCallEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO api_call_log (path, route_pattern, method, status_code, business_code, duration_ms, user_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.path, entry.routePattern, entry.method, entry.statusCode, entry.businessCode, entry.durationMs, entry.userId, entry.ip]
    )
  } catch (err) {
    // 埋点写入失败不影响业务
    logger.error('[api call log] 埋点写入失败:', err)
  }
}
