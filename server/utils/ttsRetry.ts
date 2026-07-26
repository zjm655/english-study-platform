// server/utils/ttsRetry.ts
// 词汇 TTS 带自动重试的薄封装。
//
// 背景：TTS 经 Cloudflare Worker 代理后偶发单次抖动失败，词汇发音失败会被
// 调用方静默跳过（该词永久无发音），值得对瞬时性失败自动重试。
//
// 重试策略（基于 TtsResult.errorKind 结构化分类，不做错误文案字符串匹配）：
// - network / closed：快速失败（连接拒绝/意外关闭，通常 <2s），最多重试 2 次
// - timeout：单次已耗 30s，仅重试 1 次，避免拖垮上传流水线
// - auth：密钥/鉴权类配置错误，重试只烧额度，不重试
// - errorKind 缺失（含测试 mock）：不重试，保证行为保守可预期
//
// 埋点语义：每次物理调用仍由 textToSpeech 内部各记一条 cloud_service_call_log，
// 额度消耗与失败率口径真实，重试不额外记录、不改 schema。
import { textToSpeech } from './tts'
import type { TtsResult, TtsErrorKind } from './tts'
import { fileLog } from './fileLogger'

/** 各失败类别的最大重试次数（不含首次尝试）；未列出的类别不重试 */
const MAX_RETRIES: Partial<Record<TtsErrorKind, number>> = {
  network: 2,
  closed: 2,
  timeout: 1,
}

/** 重试退避基数（毫秒），实际等待 = BACKOFF_BASE_MS × 已尝试次数 */
const BACKOFF_BASE_MS = 500

/**
 * 带自动重试的 TTS 转换（词汇发音等短文本场景）。
 * 与 textToSpeech 签名、返回值完全一致，失败返回最后一次尝试的结果。
 */
export async function ttsWithRetry(text: string, voice?: string): Promise<TtsResult> {
  let attempt = 0
  let result = await textToSpeech(text, voice)

  while (!result.success) {
    const kind = result.errorKind
    const maxRetries = (kind && MAX_RETRIES[kind]) || 0
    if (attempt >= maxRetries) break

    attempt++
    fileLog('tts', 'warn', '[ttsRetry] 转换失败，准备重试', {
      attempt,
      maxRetries,
      kind,
      error: result.error,
      textLength: text.length,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, BACKOFF_BASE_MS * attempt))
    result = await textToSpeech(text, voice)
  }

  return result
}
