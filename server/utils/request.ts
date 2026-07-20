/**
 * 服务端 HTTP 请求透明封装（所有服务端第三方 HTTP 调用的统一入口）
 *
 * 设计要点：
 * - 透明返回原生 Response：调用方的 resp.ok / resp.json() 逻辑零改动，回归风险最低
 * - 统一默认超时 30s（AbortSignal.timeout，可通过 options.timeout 覆盖）
 * - 自动记录请求/响应耗时（控制台简要 + 文件日志详细，source='api'）
 * - 异常（网络错误/超时）记录后原样抛出，交由调用方既有 try/catch 处理
 *
 * 约定：所有服务端第三方 HTTP 调用均已使用 serverFetch。
 * 例外：tts.ts（WebSocket 协议）、@alicloud/pop-core SDK（内含 HMAC-SHA1 签名）因协议/签名限制无法替换。
 * 不做自动重试（POST 重试存在重复生成/计费等副作用风险）。
 */
import { fileLog, fileLogError } from './fileLogger'

export interface ServerFetchOptions extends RequestInit {
  /** 超时毫秒数，默认 30000 */
  timeout?: number
  /** 日志标签，如 '[aiContent]' */
  tag?: string
}

/** 默认超时 30s */
const DEFAULT_TIMEOUT = 30_000

export async function serverFetch(url: string, options: ServerFetchOptions = {}): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, tag = '[serverFetch]', ...init } = options
  const method = init.method ?? 'GET'
  const start = Date.now()

  logger.info(`${tag} → ${method} ${url}`)

  try {
    // signal 由封装统一接管（AbortSignal.timeout），覆盖调用方可能传入的 signal
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) })
    const ms = Date.now() - start
    logger.info(`${tag} ← ${resp.status} (${ms}ms)`)
    // 文件日志（详细）：来源 api，非 2xx 记为 error 并双写 error-*.log
    fileLog('api', resp.ok ? 'info' : 'error', `${tag} ${method} ${url} → ${resp.status} (${ms}ms)`)
    return resp
  } catch (err) {
    const ms = Date.now() - start
    const name = err instanceof Error ? err.name : ''
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = /abort|timeout/i.test(name + msg)
    logger.error(`${tag} ✗ ${method} ${url} 失败${isTimeout ? '（超时）' : ''} (${ms}ms): ${msg}`)
    fileLogError('api', `${tag} ${method} ${url} 失败${isTimeout ? '（超时）' : ''} (${ms}ms)`, msg)
    throw err
  }
}
