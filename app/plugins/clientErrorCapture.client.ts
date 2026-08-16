// app/plugins/clientErrorCapture.client.ts
// 前端全局错误捕获（P1-E）：window error / unhandledrejection → logger.error 统一入口，
// 上报节流在 shared/utils/logger.ts 的 reportClientError 内（同消息 10s 去重 + 全局 5s 限频）。
// 客户端插件（.client 后缀），SSR 不执行。
//
// 过滤（2026-08-16 修复）：ResizeObserver 循环通知是浏览器良性警告（echarts 图表页面常见，
// 布局抖动触发，非代码错误）——此前被当错误上报污染 alert_event 表，此处拦截。
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return

  window.addEventListener('error', (e) => {
    // 浏览器良性警告白名单：ResizeObserver loop（含 "completed with undelivered notifications" /
    // "loop limit exceeded" 两种浏览器文案），不视为错误
    if (e.message && /ResizeObserver/i.test(e.message)) return
    logger.error('[window error]', e.message, e.filename, `line:${e.lineno}`)
  })

  window.addEventListener('unhandledrejection', (e) => {
    logger.error('[unhandledrejection]', e.reason)
  })
})
