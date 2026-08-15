// server/plugins/05.logArchiveScheduler.ts
// 日志自动归档调度（P1-C）：
// - 每日 tick（24h，unref，与 apiCallLogger 文件日志清理同模式），启动时先跑一次（幂等安全）；
// - 配置来自 sys_config 三键（迁移 037 seed，管理端「系统配置」页可调）：
//     log_archive_auto_enabled      总开关（'0' 完全取消自动归档，手动按钮仍可用）
//     log_archive_auto_interval_days 执行间隔（每隔 N 天执行一次，1-365）
//     log_archive_retention_days     归档阈值（迁走超过 N 天前的数据，7-3650）
// - 执行：对 ARCHIVABLE_TABLES 三表依次 archiveLogs(table, retentionDays)（内部已分批 + 100ms 防长锁）；
// - 单实例进程内定时器与 TECH_DEBT #1 约束兼容；异常吞错（旁路原则）。
import { query } from '#server/utils/db'
import { archiveLogs, ARCHIVABLE_TABLES } from '#server/services/logArchive'
import { fileLog, fileLogError } from '#server/utils/fileLogger'

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 非法配置回退默认值（与 deepseekConfig/uploadLimitChecker 同款兜底模式） */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 距今已过天数（Asia/Shanghai 日期差） */
function daysBetween(fromDate: string, toDate: string): number {
  const f = fromDate.split('-').map(Number)
  const t = toDate.split('-').map(Number)
  const a = new Date(f[0] ?? 0, (f[1] ?? 1) - 1, f[2] ?? 1).getTime()
  const b = new Date(t[0] ?? 0, (t[1] ?? 1) - 1, t[2] ?? 1).getTime()
  return Math.round((b - a) / 86_400_000)
}

export default defineNitroPlugin(() => {
  // 上次执行日期（内存态；重启后当日即跑一次——archiveLogs 幂等，INSERT IGNORE 去重）
  let lastRunDate = ''

  const tick = async (): Promise<void> => {
    try {
      const rows = await query<{ config_key: string; config_value: string }>(
        `SELECT config_key, config_value FROM sys_config
         WHERE config_key IN ('log_archive_auto_enabled', 'log_archive_auto_interval_days', 'log_archive_retention_days')`,
      )
      const cfg = new Map(rows.map((r) => [r.config_key, r.config_value]))
      if (cfg.get('log_archive_auto_enabled') === '0') return // 已取消自动归档
      const intervalDays = clampInt(cfg.get('log_archive_auto_interval_days'), 1, 1, 365)
      const retentionDays = clampInt(cfg.get('log_archive_retention_days'), 30, 7, 3650)

      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
      if (lastRunDate && daysBetween(lastRunDate, today) < intervalDays) return // 未到执行间隔
      lastRunDate = today

      for (const table of Object.keys(ARCHIVABLE_TABLES)) {
        const moved = await archiveLogs(table, retentionDays)
        if (moved > 0) {
          fileLog(
            'db',
            'info',
            `[log archive] 自动归档 ${table} 迁入 ${moved} 行（保留 ${retentionDays} 天）`,
          )
        }
      }
    } catch (err) {
      // 自动归档是旁路能力：失败仅留痕，不影响业务
      fileLogError('db', '[log archive] 自动归档失败', err instanceof Error ? err : String(err))
    }
  }

  // 启动即跑一次（幂等安全：归档迁移 INSERT IGNORE 去重）
  void tick()

  const timer = setInterval(() => {
    void tick()
  }, TICK_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
})
