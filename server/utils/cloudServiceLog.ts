// server/utils/cloudServiceLog.ts
// 云服务调用埋点写入：记录所有第三方云服务调用（DeepSeek / TTS / OSS / NLS / BSS）。
//
// 设计要点：
// - 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程
// - 调用方以 fire-and-forget 方式调用（不 await），对请求延迟零影响
// - 匹配 apiCallLog.ts 的写入模式（query + try/catch + logger.error）
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
}

/**
 * 写入一条云服务调用埋点。
 * 调用方以 fire-and-forget 方式调用：void logCloudServiceCall(...)
 */
export async function logCloudServiceCall(entry: CloudServiceCallEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO cloud_service_call_log (service, operation, success, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      [entry.service, entry.operation, entry.success ? 1 : 0, entry.durationMs, entry.errorMessage ?? null],
    )
  } catch (err) {
    // 埋点写入失败不影响业务
    logger.error('[cloud service log] 埋点写入失败:', err)
  }
}