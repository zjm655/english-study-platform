// server/plugins/apiCallLogger.ts
// Nitro 服务端插件：API 调用埋点（运营统计数据源）。
//
// 为什么用 plugin 而非 middleware：
// - server middleware 按文件名字母序执行，埋点中间件排在 auth 之前拿不到 event.context.user
// - plugin 的 request 钩子在整条中间件链之前触发（精确计时），afterResponse 在响应发送后触发
//   （此时 auth 已执行完毕，user 必定已挂载），天然无顺序耦合
//
// 性能保证：afterResponse 中仅做纯内存取值 + fire-and-forget 调用，对请求延迟零影响。
export default defineNitroPlugin((nitroApp) => {
  // 请求进入（中间件链之前）：仅对 /api 路径打时间戳
  nitroApp.hooks.hook('request', (event) => {
    if (!event.path.startsWith('/api')) return
    event.context._apiLogStart = Date.now()
  })

  // 响应发送后：异步写入埋点（不 await，写入失败静默吞错）
  nitroApp.hooks.hook('afterResponse', (event) => {
    const start = event.context._apiLogStart as number | undefined
    if (!start) return
    logApiCall({
      path: event.path.slice(0, 200),
      method: event.method,
      statusCode: event.node.res.statusCode,
      durationMs: Date.now() - start,
      userId: event.context.user?.id ?? null,
      ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
    })
  })
})
