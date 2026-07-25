// app/plugins/authVerify.server.ts
import { useVerifySSR } from '~/composables/user'

/**
 * SSR 首屏登录校验插件（.server 后缀，仅服务端执行）
 *
 * 插件先于路由中间件运行，天然「一次/请求」：
 * - 有 token cookie → 内部直调 /api/user/verify，登录态写入 Pinia
 *   → payload 序列化 → client 水合复用（免一次客户端 verify RTT）
 * - 无 cookie（游客/爬虫）→ useVerifySSR 内部短路，零成本
 * - /admin/**（ssr:false）无 SSR 阶段，不经过本插件，client 中间件兜底
 */
export default defineNuxtPlugin(async () => {
  await useVerifySSR()
})
