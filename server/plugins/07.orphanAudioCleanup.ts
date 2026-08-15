// server/plugins/07.orphanAudioCleanup.ts
// 失败记录音频孤儿清理（P2-E）：status='failed' 且超期未重处理的 material_upload_record，
// 其 audio_oss_key 指向的 OSS 对象长期无人引用（重处理复用窗口已过），每日扫描清理。
//
// 设计要点：
// - 窗口期：orphan_audio_retention_days（sys_config，默认 7 天，迁移 038 seed）；
//   重处理会把 status 改为 queued，天然不在扫描范围——超期仍 failed 即视为放弃复用。
// - 清理顺序（防并发误删）：先 deleteObject 成功 → 再 UPDATE 置空 key（带 status='failed'
//   条件，affected=0 说明已被重处理抢占，放弃）；deleteObject 失败不置空，下次再试。
// - 置空后重处理走 TTS 合成路径（materialReprocess 已兼容 audioOssKey 为空）。
// - 每日 tick + 启动即跑（unref）；分批 + 100ms 间隔防长锁；异常吞错（旁路原则）。
import { query } from '#server/utils/db'
import { deleteObject } from '#server/utils/oss'
import { fileLog, fileLogError } from '#server/utils/fileLogger'
import type { ResultSetHeader } from 'mysql2'

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 每批扫描行数 */
const BATCH_SIZE = 50
const BATCH_INTERVAL_MS = 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default defineNitroPlugin(() => {
  const tick = async (): Promise<void> => {
    try {
      const cfgRows = await query<{ config_value: string }>(
        `SELECT config_value FROM sys_config WHERE config_key = 'orphan_audio_retention_days'`,
      )
      const rawDays = Number.parseInt(cfgRows[0]?.config_value ?? '', 10)
      const retentionDays = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, rawDays)) : 7

      for (;;) {
        const rows = await query<{ id: number; audio_oss_key: string }>(
          `SELECT id, audio_oss_key FROM material_upload_record
           WHERE status = 'failed' AND audio_oss_key IS NOT NULL
             AND updatedAt < DATE_SUB(NOW(), INTERVAL ? DAY)
           LIMIT ${BATCH_SIZE}`,
          [retentionDays],
        )
        if (rows.length === 0) break

        for (const row of rows) {
          try {
            // 先删对象（成功才置空；失败保留 key 下次再试）
            await deleteObject(row.audio_oss_key)
            // UPDATE 经裸 pool.query 返回 ResultSetHeader（非行数组），类型断言先例见 materialReprocess
            const res = await query<ResultSetHeader>(
              `UPDATE material_upload_record SET audio_oss_key = NULL
               WHERE id = ? AND status = 'failed'`,
              [row.id],
            )
            const affected = Number((res as unknown as ResultSetHeader).affectedRows ?? 0)
            fileLog(
              'db',
              affected > 0 ? 'info' : 'warn',
              `[orphan cleanup] ${affected > 0 ? '已清理' : '已被重处理抢占，跳过'} 失败记录音频`,
              { recordId: row.id, key: row.audio_oss_key },
            )
          } catch (err) {
            fileLogError(
              'db',
              '[orphan cleanup] 单个对象清理失败',
              JSON.stringify({
                recordId: row.id,
                error: err instanceof Error ? err.message : String(err),
              }),
            )
          }
        }
        if (rows.length < BATCH_SIZE) break
        await sleep(BATCH_INTERVAL_MS)
      }
    } catch (err) {
      // 旁路能力：失败仅留痕
      fileLogError('db', '[orphan cleanup] 孤儿清理失败', err instanceof Error ? err : String(err))
    }
  }

  // 启动即跑一次 + 每日 tick（unref 不阻止进程退出）
  void tick()
  const timer = setInterval(() => {
    void tick()
  }, TICK_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
})
