// server/utils/rateLimitHitThrottle.ts
// 限流命中安全告警节流（P4，TECH_DEBT #1 缺口 6）：把 apiCallLogger 插件里进程内 Map 节流
// 外置到 rateStore 固定窗口计数（Redis + 内存双 Adapter），使节流在**多实例**间共享——
// 原实现每实例各自持有一份 rateLimitHitEvents Map，多实例下同一 IP 每实例都会告警一次
// （告警翻 N 倍）；改为共享计数后，10 分钟固定窗口内每 IP 仅首条告警落库（count===1）。
//
// 语义：
// - 固定窗口 600s：窗口内 count≥2 均为后续命中，不再重复告警；窗口过期计数归零重开。
// - 被拒也计数（D-P2-2）：每次调用都 incr，由 count 判定——原子无竞态，且攻击者持续消耗自身告警额度。
// - 走 'evt' 域计数键（ep:{env}:evt:rate_limit_hit:{ip}），与限流计数（'rl'/'fail'）互不挤占。
import { incrWindow } from '#server/utils/rateStore'

/**
 * 判定当前 IP 是否应记录限流命中安全告警：10 分钟固定窗口内仅首次命中返回 true
 *（窗口计数经 rateStore 在 Redis / 内存双路径共享，跨实例去重）。
 */
export async function shouldLogRateLimitHit(ip: string): Promise<boolean> {
  const { count } = await incrWindow('evt', `rate_limit_hit:${ip}`, 600)
  return count === 1
}
