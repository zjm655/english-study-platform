// server/utils/cloudHealthDedup.ts
// 云健康骤升告警去重（P4 多实例）：同一 service 30 分钟内仅首次骤升写 alert_event。
// 复用 rateStore 固窗计数（Redis + 内存 Adapter 双路径）——P4 多实例去重、rateStore 固窗计数
// 跨实例共享、Redis 不可用经内存 Adapter 降级（多实例竞态窗口回归可接受）。
import { incrWindow } from '#server/utils/rateStore'

/** 去重窗口：30 分钟（秒），对齐旧实现的 DEDUP_WINDOW_MS */
const DEDUP_WINDOW_SEC = 1800

/**
 * 判定是否应上报云健康骤升告警：rateStore 固窗计数自增后，仅窗口内首次（count===1）上报。
 * evt 域 + `cloud_health:${service}` id → key 形如 ep:{env}:evt:cloud_health:tts。
 */
export async function shouldReportCloudHealthSpike(service: string): Promise<boolean> {
  const { count } = await incrWindow('evt', `cloud_health:${service}`, DEDUP_WINDOW_SEC)
  return count === 1
}
