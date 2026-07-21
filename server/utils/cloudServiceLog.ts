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

const queue: CloudServiceCallEntry[] = []
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
      e.service, e.operation, e.success ? 1 : 0, e.durationMs,
      e.promptTokens ?? null, e.completionTokens ?? null,
      e.totalTokens ?? null, e.errorMessage ?? null,
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
  queue.push(entry)
  ensureTimer()
  if (queue.length >= BATCH_SIZE) {
    void flush()
  }
}

/** 进程退出前最后 flush（供 Nitro close 钩子调用） */
export async function flushCloudServiceLog(): Promise<void> {
  await flush()
}