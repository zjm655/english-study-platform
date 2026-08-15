const formatTime = (ts: number = Date.now()) =>
  new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

const getPrefix = (level: string) => `[${formatTime()}][${level}]`

let _logger: ReturnType<typeof createLogger> | null = null

function createLogger(enabled: boolean) {
  return {
    log(...args: unknown[]) {
      if (enabled) console.log(getPrefix('LOG'), ...args)
    },
    info(...args: unknown[]) {
      if (enabled) console.info(getPrefix('INFO'), ...args)
    },
    warn(...args: unknown[]) {
      if (enabled) console.warn(getPrefix('WARN'), ...args)
    },
    debug(...args: unknown[]) {
      if (enabled) console.debug(getPrefix('DEBUG'), ...args)
    },
    error(...args: unknown[]) {
      console.error(getPrefix('ERROR'), ...args)
      // 生产环境上报（P1-E）：错误必须留痕，不依赖 isOpenLog（生产 console 关闭但错误仍要上报）；
      // 节流在 reportClientError 内（同消息 10s 去重 + 全局 5s 限频），防错误风暴打爆上报端点
      if (import.meta.client) {
        void reportClientError(args)
      }
    },
  }
}

function getInstance() {
  if (!_logger) {
    const cfg = useRuntimeConfig()
    const isOpen =
      (import.meta.client ? cfg.public.isOpenLog && import.meta.dev : cfg.isOpenLog) ?? false
    _logger = createLogger(isOpen)
  }
  return _logger
}

export const logger = {
  get log() {
    return getInstance().log
  },
  get info() {
    return getInstance().info
  },
  get warn() {
    return getInstance().warn
  },
  get debug() {
    return getInstance().debug
  },
  get error() {
    return getInstance().error
  },
}

// ─── 前端错误上报（P1-E，仅在客户端生效）────────────────────────
// 节流策略：同消息 10s 内只报一次 + 全局 5s 限频 + 去重 Map 有界（200 条循环清空），
// 防止重复错误/错误风暴打爆公开上报端点；上报失败静默（旁路原则）。
const ERROR_REPORT_GAP_MS = 5000
const ERROR_REPORT_DEDUP_MS = 10_000
const ERROR_REPORT_MAP_MAX = 200
let lastClientErrorReportAt = 0
const recentClientErrorMessages = new Map<string, number>()

/** 错误参数序列化：message 截 500，首个 Error 的 stack 截 4000 */
function serializeErrorArgs(args: unknown[]): { message: string; stack?: string } {
  const parts: string[] = []
  let stack: string | undefined
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.message)
      if (!stack) stack = a.stack
    } else if (typeof a === 'string') {
      parts.push(a)
    } else {
      try {
        parts.push(JSON.stringify(a))
      } catch {
        parts.push(String(a))
      }
    }
  }
  return { message: parts.join(' ').slice(0, 500), stack: stack?.slice(0, 4000) }
}

/** 当前页面 URL（截 500；无 DOM 环境（SSR/测试）返回 undefined） */
function currentPageUrl(): string | undefined {
  try {
    const href = (globalThis as { location?: { href?: string } }).location?.href
    return href ? href.slice(0, 500) : undefined
  } catch {
    return undefined
  }
}

async function reportClientError(args: unknown[]): Promise<void> {
  const now = Date.now()
  if (now - lastClientErrorReportAt < ERROR_REPORT_GAP_MS) return
  const { message, stack } = serializeErrorArgs(args)
  if (!message) return
  const lastAt = recentClientErrorMessages.get(message)
  if (lastAt !== undefined && now - lastAt < ERROR_REPORT_DEDUP_MS) return
  if (recentClientErrorMessages.size >= ERROR_REPORT_MAP_MAX) recentClientErrorMessages.clear()
  recentClientErrorMessages.set(message, now)
  lastClientErrorReportAt = now
  try {
    await fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        ...(stack ? { stack } : {}),
        ...(currentPageUrl() ? { url: currentPageUrl() } : {}),
      }),
    })
  } catch {
    // 上报失败静默（旁路）
  }
}
