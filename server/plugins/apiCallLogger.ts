// server/plugins/apiCallLogger.ts
// Nitro 服务端插件：API 调用埋点（运营统计数据源）+ 限流保护。
//
// 为什么用 plugin 而非 middleware：
// - server middleware 按文件名字母序执行，埋点中间件排在 auth 之前拿不到 event.context.user
// - plugin 的 request 钩子在整条中间件链之前触发（精确计时），afterResponse 在响应发送后触发
//   （此时 auth 已执行完毕，user 必定已挂载），天然无顺序耦合
//
// 5xx 兜底（error 钩子）：handler 抛错时 h3 的 errorHandler 发送响应后 event.handled=true
// 会短路 afterResponse（恒不触发），抛出的 4xx/5xx/404 全部漏记——靠 'error' 钩子补记，
// 双入口用 event.context._apiLogged 标志去重（钩子自身出错的边缘路径两钩子可能都触发）。
//
// 性能保证：afterResponse 中仅做纯内存取值 + fire-and-forget 调用，对请求延迟零影响。
import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import {
  logApiCall,
  flushApiCallLog,
  truncateDiag,
  DIAG_MESSAGE_MAX,
  DIAG_STACK_MAX,
} from '#server/utils/apiCallLog'
import { flushCloudServiceLog } from '#server/utils/cloudServiceLog'
import { flushOssPlaybackLog } from '#server/utils/ossPlaybackLog'
import { flushAlertEventLog } from '#server/utils/alertEventLog'
import { checkRateLimit, getRateLimitConfig } from '#server/utils/rateLimiter'
import { fileLogError, cleanupOldLogs } from '#server/utils/fileLogger'

/** 隐私红线：认证类路径不记录 error_stack（堆栈可能携带请求参数，防账号/密码泄漏） */
const STACK_EXCLUDED_PATHS = new Set(['/api/user/login', '/api/user/register', '/api/user/captcha'])

export default defineNitroPlugin((nitroApp) => {
  // 启动时清理过期文件日志（一次性 fire-and-forget）：
  // Nitro 的 runNitroPlugins 不 await 插件 Promise（既有陷阱，见 02.queueRecovery），
  // 此处 void 掉且 cleanupOldLogs 内部全程吞错，绝不阻塞启动。
  const retentionDays = Number(useRuntimeConfig().logRetentionDays) || 30
  void cleanupOldLogs(retentionDays)

  // 文件日志每日定时清理（P0-C′）：长跑不重启时 logs/ 不再无限增长（磁盘风险）。
  // 与埋点队列定时器同模式：unref 不阻止进程退出；保留天数仍取 NUXT_LOG_RETENTION_DAYS；
  // 单实例进程内定时器与 TECH_DEBT #1 约束兼容（水平扩展前外置）。
  const dailyCleanupTimer = setInterval(
    () => {
      void cleanupOldLogs(retentionDays)
    },
    24 * 60 * 60 * 1000,
  )
  if (dailyCleanupTimer && typeof dailyCleanupTimer === 'object' && 'unref' in dailyCleanupTimer) {
    dailyCleanupTimer.unref()
  }

  // 统一记录入口：afterResponse（正常响应）与 error（抛错兜底）共用，_apiLogged 保证每请求只记一条
  function record(
    event: H3Event,
    statusCode: number,
    errorMessage?: string | null,
    errorStack?: string | null,
  ): void {
    if (event.context._apiLogged) return
    event.context._apiLogged = true
    // OSS 播放埋点端点自身不写 api_call_log：否则每次播放都自记录，放大埋点表并污染统计
    if (event.path === '/api/oss/playback') return
    const start = event.context._apiLogStart as number | undefined
    logApiCall({
      path: event.path.slice(0, 200),
      routePattern: event.context.matchedRoute?.path ?? null,
      method: event.method,
      statusCode,
      businessCode: (event.context._apiLogBusinessCode as number) ?? null,
      durationMs: start ? Date.now() - start : 0,
      userId: event.context.user?.id ?? null,
      ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
      requestId: (event.context.requestId as string) ?? null,
      errorMessage: errorMessage ?? null,
      errorStack: errorStack ?? null,
    })
  }

  // 请求进入（中间件链之前）：限流检查 + 打时间戳
  nitroApp.hooks.hook('request', async (event) => {
    if (!event.path.startsWith('/api')) return

    // 限流检查（IP 级，用户级限流在 auth 中间件中处理；上传路径独立于全局 enabled）
    const rateLimitConfig = await getRateLimitConfig()
    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const { allowed, retryAfter } = checkRateLimit(ip, event.path, rateLimitConfig)
    if (!allowed) {
      event.node.res.statusCode = 429
      event.node.res.setHeader('Content-Type', 'application/json; charset=utf-8')
      event.node.res.setHeader('Retry-After', String(retryAfter))
      event.node.res.end(
        JSON.stringify({
          code: 429,
          message: `请求过于频繁，请 ${retryAfter} 秒后重试`,
          data: null,
        }),
      )
      // 标记已处理，阻止后续 handler 执行
      ;(event as { _handled?: boolean })._handled = true
      // IP 级 429 在此直接补记：此处提前 return 导致 _apiLogStart 未设、afterResponse 不会记录，
      // 若不补记则攻击/高频期错误率反而显示为 0
      event.context._apiLogBusinessCode = 429
      record(event, 429)
      return
    }

    // 限流通过后生成请求短 ID：DB 埋点与文件日志共用，实现双向定位（勿新增依赖，用 Node 内置）
    event.context.requestId = randomUUID().slice(0, 8)
    event.context._apiLogStart = Date.now()
  })

  // 响应发送前：捕获业务错误码（body 为 handler 返回值，尚未序列化）
  // 本项目所有 API 均返回 ResPayload<T>，即 { code, message, data }，body.code 必定存在。
  nitroApp.hooks.hook('beforeResponse', (event, { body }) => {
    if (!event.path.startsWith('/api')) return
    if (body && typeof body === 'object' && 'code' in body) {
      const code = (body as Record<string, unknown>).code
      if (typeof code === 'number') {
        event.context._apiLogBusinessCode = code
      }
    }
  })

  // 响应发送后：异步写入埋点（不 await，写入失败静默吞错）
  nitroApp.hooks.hook('afterResponse', (event) => {
    if (!event.path.startsWith('/api')) return
    record(event, event.node.res.statusCode)
  })

  // 抛错兜底：createError 抛出的 4xx/5xx、未捕获异常 500、未匹配 /api 路由的 404 均走此处
  //（h3 错误路径不触发 afterResponse）。statusCode 优先取 H3Error.statusCode（h3 已归一化，
  // 恒存在），不读 res.statusCode——error 钩子并行触发，此刻响应可能尚未写出。
  nitroApp.hooks.hook('error', (error, { event }) => {
    if (!event || !event.path?.startsWith('/api')) return
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500
    // 提取错误诊断信息：message 截断 500；stack 仅 5xx 记录（4xx 是预期业务拒绝，堆栈无诊断价值）
    // 且认证类路径跳过（隐私红线：堆栈可能携带账号/密码等请求参数）
    const errorMessage = truncateDiag(
      error instanceof Error ? error.message : String(error),
      DIAG_MESSAGE_MAX,
    )
    const pathname = event.path.split('?')[0] ?? event.path
    const stackAllowed = statusCode >= 500 && !STACK_EXCLUDED_PATHS.has(pathname)
    const errorStack = stackAllowed
      ? truncateDiag(error instanceof Error ? (error.stack ?? null) : null, DIAG_STACK_MAX)
      : null
    // 文件日志（fire-and-forget，fileLogError 自吞错）：requestId 与 DB 行互查
    void fileLogError('api', {
      requestId: (event.context.requestId as string) ?? null,
      path: event.path,
      statusCode,
      message: errorMessage,
      stack: errorStack,
    })
    record(event, statusCode, errorMessage, errorStack)
  })

  // 进程退出前最后 flush 队列中残留的埋点数据
  nitroApp.hooks.hook('close', async () => {
    await flushApiCallLog()
    await flushCloudServiceLog()
    await flushOssPlaybackLog()
    await flushAlertEventLog()
  })
})
