// app/plugins/clientErrorCapture.client.ts
// 前端全局错误捕获（P1-E）：window error / unhandledrejection → logger.error 统一入口，
// 上报节流在 shared/utils/logger.ts 的 reportClientError 内（同消息 10s 去重 + 全局 5s 限频）。
// 客户端插件（.client 后缀），SSR 不执行。
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return

  window.addEventListener('error', (e) => {
    logger.error('[window error]', e.message, e.filename, `line:${e.lineno}`)
  })

  window.addEventListener('unhandledrejection', (e) => {
    logger.error('[unhandledrejection]', e.reason)
  })
})
