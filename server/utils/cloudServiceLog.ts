// server/utils/cloudServiceLog.ts
// 云服务调用埋点写入：记录所有第三方云服务调用（DeepSeek / TTS / OSS / NLS / BSS）。
//
// 批量写入模式：内存队列 + 定时 flush + 达到阈值立即 flush。
// 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程。
// 调用方以 fire-and-forget 方式调用，对请求延迟零影响。
import { query } from '#server/utils/db'

/** 云服务标识 */
export type CloudService = 'deepseek' | 'tts' | 'oss' | 'nls' | 'bss'

/** 单条云服务调用埋点 */
export interface CloudServiceCallEntry {
  service: CloudService | (string & {})
  operation: string
  success: boolean
  durationMs: number
  errorMessage?: string | null
  /** DeepSeek 输入 token 数（仅 deepseek 服务） */
  promptTokens?: number | null
  /** DeepSeek 输出 token 数（仅 deepseek 服务） */
  completionTokens?: number | null
  /** DeepSeek 总 token 数（仅 deepseek 服务） */
  totalTokens?: number | null
}

// ─── 内存队列 ────────────────────────────────────────

const BATCH_SIZE = 50
const FLUSH_INTERVAL_MS = 5000
/** 队列软上限：超限时丢弃最旧条目，防止 DB 写入变慢时队列无界增长导致 OOM（埋点为旁路，可容忍丢弃） */
const MAX_QUEUE_SIZE = 10_000

const queue: CloudServiceCallEntry[] = []
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
    const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = batch.flatMap((e) => [
      e.service,
      e.operation,
      e.success ? 1 : 0,
      e.durationMs,
      e.promptTokens ?? null,
      e.completionTokens ?? null,
      e.totalTokens ?? null,
      e.errorMessage || null, // 空串归一为 NULL，避免导出/统计出现空白 error_message
    ])
    await query(
      `INSERT INTO cloud_service_call_log (service, operation, success, duration_ms, prompt_tokens, completion_tokens, total_tokens, error_message)
       VALUES ${values}`,
      params,
    )
  } catch (err) {
    logger.error('[cloud service log] 批量写入失败:', err)
    // 静默丢弃本批数据，不重试
  }
}

/**
 * 写入一条云服务调用埋点（入队，不阻塞）。
 * 调用方以 fire-and-forget 方式调用：void logCloudServiceCall(...)
 */
export function logCloudServiceCall(entry: CloudServiceCallEntry): void {
  // 失败条目兜底：error_message 永不为空（上游偶有空 message 的异常，如 AggregateError），
  // 保证 success=0 的行必有可诊断内容，不限于 TTS 服务
  if (!entry.success && !entry.errorMessage?.trim()) {
    entry.errorMessage = '(空错误信息)'
  }
  // 软上限保护：超限丢弃最旧条目，避免 DB 写入慢时队列无界增长导致 OOM
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
    droppedCount++
    if (droppedCount === 1 || droppedCount % 1000 === 0) {
      logger.warn(
        `[cloud service log] 队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条埋点`,
      )
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
export async function flushCloudServiceLog(): Promise<void> {
  while (queue.length > 0) {
    await flush()
  }
}
