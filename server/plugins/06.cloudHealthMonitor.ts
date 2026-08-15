// server/plugins/06.cloudHealthMonitor.ts
// 云失败率骤升检测（P2-D）：定期（默认每 5 分钟）用 SQL 查最近 N 分钟窗口内
// cloud_service_call_log 按 service 分组的失败率，超阈值写 alert_event（source=cloud_health）。
//
// 口径（sys_config 可配，迁移 038 seed）：
// - cloud_health_window_min（默认 5）：检测窗口（分钟）
// - cloud_health_fail_threshold_pct（默认 50）：窗口失败率阈值（%）
// - cloud_health_min_failures（默认 5）：窗口最少失败条数（防低频误报）
// 去重：同一 service 30 分钟内已报过骤升事件则跳过（查 alert_event 最近记录）。
// 单实例进程内定时器与 TECH_DEBT #1 约束兼容；异常吞错（旁路原则）。
import { query } from '#server/utils/db'
import { logAlertEvent } from '#server/utils/alertEventLog'
import { fileLogError } from '#server/utils/fileLogger'

const TICK_INTERVAL_MS = 5 * 60 * 1000
/** 同 service 骤升事件去重窗口（毫秒） */
const DEDUP_WINDOW_MS = 30 * 60 * 1000

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export default defineNitroPlugin(() => {
  const tick = async (): Promise<void> => {
    try {
      // 1. 读配置（5 分钟频率，直接查库无需缓存）
      const cfgRows = await query<{ config_key: string; config_value: string }>(
        `SELECT config_key, config_value FROM sys_config
         WHERE config_key IN ('cloud_health_window_min', 'cloud_health_fail_threshold_pct', 'cloud_health_min_failures')`,
      )
      const cfg = new Map(cfgRows.map((r) => [r.config_key, r.config_value]))
      const windowMin = clampInt(cfg.get('cloud_health_window_min'), 5, 1, 60)
      const thresholdPct = clampInt(cfg.get('cloud_health_fail_threshold_pct'), 50, 1, 100)
      const minFailures = clampInt(cfg.get('cloud_health_min_failures'), 5, 1, 1000)

      // 2. 窗口内按 service 分组统计（COUNT + 失败数；trial 行不参与：service='nls' 的
      //    createToken/sttFallback 为诊断行，保持全量统计即可——骤升看的是整体失败占比）
      const rows = await query<{ service: string; total: number | string; fails: number | string }>(
        `SELECT service, COUNT(*) AS total, SUM(success = 0) AS fails
         FROM cloud_service_call_log
         WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
         GROUP BY service`,
        [windowMin],
      )

      for (const row of rows) {
        const total = Number(row.total ?? 0)
        const fails = Number(row.fails ?? 0)
        if (total < 1 || fails < minFailures) continue
        const rate = (fails / total) * 100
        if (rate < thresholdPct) continue

        // 3. 去重：30 分钟内同 service 已报过骤升则跳过
        const recent = await query<{ cnt: number | string }>(
          `SELECT COUNT(*) AS cnt FROM alert_event
           WHERE source = 'cloud_health' AND context->>'$.service' = ?
             AND createdAt >= DATE_SUB(NOW(), INTERVAL ${DEDUP_WINDOW_MS / 60_000} MINUTE)`,
          [row.service],
        )
        if (Number(recent[0]?.cnt ?? 0) > 0) continue

        void logAlertEvent({
          source: 'cloud_health',
          level: 'error',
          code: 'cloud_failure_rate_spike',
          message: `云服务 ${row.service} 失败率骤升：${rate.toFixed(1)}%（${fails}/${total}，窗口 ${windowMin} 分钟）`,
          context: {
            service: row.service,
            windowMin,
            failCount: fails,
            totalCount: total,
            rate: Math.round(rate * 10) / 10,
          },
        })
      }
    } catch (err) {
      // 旁路能力：失败仅留痕
      fileLogError('db', '[cloud health] 骤升检测失败', err instanceof Error ? err : String(err))
    }
  }

  // 启动即跑一次 + 每 5 分钟 tick（unref 不阻止进程退出）
  void tick()
  const timer = setInterval(() => {
    void tick()
  }, TICK_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
})
