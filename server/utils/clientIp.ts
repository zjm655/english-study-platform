// server/utils/clientIp.ts
// 统一客户端 IP 获取（P3-A）：X-Forwarded-For 信任链收口。
//
// 背景：h3 的 getRequestIP({xForwardedFor:true}) 取 XFF 链首值；此前 nginx 用
// $proxy_add_x_forwarded_for 追加（客户端伪造 IP 恒排链首），IP 级限流可被伪造击穿。
// 修复：nginx 已改为覆盖 XFF = $remote_addr（可信对端），本 helper 用 runtimeConfig.trustProxy
// 控制是否信任 XFF——
// - docker 部署（nginx 在前）：trustProxy=true（默认），取链首 = 可信对端；
// - pm2 直连部署：设 NUXT_TRUST_PROXY=false，忽略 XFF 只读 socket IP。
import type { H3Event } from 'h3'
import { getRequestIP } from 'h3'

/** 统一客户端 IP（全项目限流/埋点/审计取 IP 的唯一入口，禁止散用 getRequestIP） */
export function getClientIp(event: H3Event): string {
  // 防御：非真实请求（测试 mock event 无 node.req）回退 'unknown'；真实 Nitro 请求恒有 node.req
  if (!event.node?.req) return 'unknown'
  // 读取进程 env（NUXT_TRUST_PROXY，与 runtimeConfig.trustProxy 同源注入；测试环境无 env → 默认 true）
  const trustProxy = process.env.NUXT_TRUST_PROXY !== 'false'
  return getRequestIP(event, trustProxy ? { xForwardedFor: true } : {}) || 'unknown'
}
