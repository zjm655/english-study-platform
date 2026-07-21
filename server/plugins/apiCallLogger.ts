// server/plugins/apiCallLogger.ts
// Nitro 服务端插件：API 调用埋点（运营统计数据源）+ 限流保护。
//
// 为什么用 plugin 而非 middleware：
// - server middleware 按文件名字母序执行，埋点中间件排在 auth 之前拿不到 event.context.user
// - plugin 的 request 钩子在整条中间件链之前触发（精确计时），afterResponse 在响应发送后触发
//   （此时 auth 已执行完毕，user 必定已挂载），天然无顺序耦合
//
// 性能保证：afterResponse 中仅做纯内存取值 + fire-and-forget 调用，对请求延迟零影响。
import { logApiCall, flushApiCallLog } from '#server/utils/apiCallLog'
import { flushCloudServiceLog } from '#server/utils/cloudServiceLog'
import { checkRateLimit } from '#server/utils/rateLimiter'
export default defineNitroPlugin((nitroApp) => {
  // 请求进入（中间件链之前）：限流检查 + 打时间戳
  nitroApp.hooks.hook('request', (event) => {
    if (!event.path.startsWith('/api')) return

    // 限流检查（登录用户按 userId@ip 限流，未登录按 IP 限流）
    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const userId = event.context.user?.id
    const { allowed, retryAfter } = checkRateLimit(ip, event.path, userId)
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
      return
    }

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
    const start = event.context._apiLogStart as number | undefined
    if (!start) return
    logApiCall({
      path: event.path.slice(0, 200),
      routePattern: event.context.matchedRoute?.path ?? null,
      method: event.method,
      statusCode: event.node.res.statusCode,
      businessCode: (event.context._apiLogBusinessCode as number) ?? null,
      durationMs: Date.now() - start,
      userId: event.context.user?.id ?? null,
      ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
    })
  })

  // 进程退出前最后 flush 队列中残留的埋点数据
  nitroApp.hooks.hook('close', async () => {
    await flushApiCallLog()
    await flushCloudServiceLog()
  })
})
