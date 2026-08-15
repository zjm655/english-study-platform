// server/utils/cloudServiceLog.ts
// 云服务调用埋点写入：记录所有第三方云服务调用（DeepSeek / TTS / OSS / NLS / BSS / edu）。
//
// 批量写入模式（P3-I 重构）：内存队列逻辑统一收敛到 batchQueue 工厂；
// requestId 经请求上下文自动填充（getCurrentRequestId），调用方显式传入优先。
// 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程。
import { createBatchQueue } from '#server/utils/batchQueue'
import { getCurrentRequestId } from '#server/utils/requestContext'
import { logAlertEvent } from '#server/utils/alertEventLog'

/** 云服务标识 */
export type CloudService = 'deepseek' | 'tts' | 'oss' | 'nls' | 'bss' | 'edu'

/** 单条云服务调用埋点 */
export interface CloudServiceCallEntry {
  service: CloudService | (string & {})
  operation: string
  /** 触发请求短 ID（8 位，与 api_call_log.request_id 互查；任务流水线经请求上下文自动填充，可显式覆盖） */
  requestId?: string | null
  success: boolean
  durationMs: number
  errorMessage?: string | null
  /** DeepSeek 输入 token 数（仅 deepseek 服务） */
  promptTokens?: number | null
  /** DeepSeek 输出 token 数（仅 deepseek 服务） */
  completionTokens?: number | null
  /** DeepSeek 总 token 数（仅 deepseek 服务） */
  totalTokens?: number | null
  /** 业务时长毫秒（nls filetrans=音频时长 BizDuration，区别于 durationMs 执行耗时） */
  bizDurationMs?: number | null
}

// ─── 批量队列（P3-I：由 batchQueue 工厂统一实现）────────────

const BATCH_SIZE = 50
const MAX_QUEUE_SIZE = 10_000

const cloudServiceQueue = createBatchQueue<CloudServiceCallEntry>({
  batchSize: BATCH_SIZE,
  maxQueueSize: MAX_QUEUE_SIZE,
  errorLabel: '[cloud service log] 批量写入失败:',
  enrich: (entry) => {
    // 请求上下文自动填充 requestId（显式传入优先；无上下文/后台路径为 null，关联键留空）
    entry.requestId = entry.requestId ?? getCurrentRequestId() ?? null
  },
  buildSql: (batch) => {
    const values = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const params = batch.flatMap((e) => [
      e.service,
      e.operation,
      e.requestId ?? null,
      e.success ? 1 : 0,
      e.durationMs,
      e.promptTokens ?? null,
      e.completionTokens ?? null,
      e.totalTokens ?? null,
      e.bizDurationMs ?? null,
      e.errorMessage || null, // 空串归一为 NULL，避免导出/统计出现空白 error_message
    ])
    return {
      sql: `INSERT INTO cloud_service_call_log (service, operation, request_id, success, duration_ms, prompt_tokens, completion_tokens, total_tokens, biz_duration_ms, error_message)
       VALUES ${values}`,
      params,
    }
  },
  onDrop: (droppedCount) => {
    logger.warn(`[cloud service log] 队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条埋点`)
    // P1：丢弃事件落库（alert_event 为未来告警通道数据源）
    void logAlertEvent({
      source: 'log_queue',
      level: 'warn',
      code: 'log_queue_dropped',
      message: `cloud_service_call_log 埋点队列超过 ${MAX_QUEUE_SIZE}，已累计丢弃 ${droppedCount} 条`,
      context: { droppedCount },
    })
  },
})

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
  cloudServiceQueue.push(entry)
}

/**
 * 进程退出前把队列全部写完（供 Nitro close 钩子调用）。
 */
export async function flushCloudServiceLog(): Promise<void> {
  await cloudServiceQueue.flushAll()
}

/** 只读探针：内存缓冲水位快照（供 GET /api/admin/monitor 观测，不暴露队列引用） */
export function getCloudServiceLogStats(): { size: number; maxSize: number; dropped: number } {
  return cloudServiceQueue.getStats()
}
