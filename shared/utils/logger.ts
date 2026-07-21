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
      // 生产环境上报
    },
  }
}

function getInstance() {
  if (!_logger) {
    const cfg = useRuntimeConfig()
    const isOpen = import.meta.client ? cfg.public.isOpenLog && import.meta.dev : cfg.isOpenLog
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
