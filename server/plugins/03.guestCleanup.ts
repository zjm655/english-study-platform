// server/plugins/03.guestCleanup.ts
// 启动期游客数据清理：物理删除已合并的游客行 + 过期未合并的游客行及其关联数据。
//
// 清理策略：
// 1. 已合并行（merged_into_user_id IS NOT NULL）：数据已迁移到正式用户，安全物理删除
// 2. 过期未合并行：最后活跃超过 guest_retention_days 天（默认 180），视为废弃数据
//
// 注意：Nitro 的 runNitroPlugins 同步调用插件且不 await 返回的 Promise，
// 插件执行期间服务已可受理请求。以 startedAt 为界，只清理启动前已存在的游客行，
// 避免误删启动窗口期新建的游客行。
import { query, withTransaction } from '#server/utils/db'
import { fileLog } from '#server/utils/fileLogger'
import { withClusterLock } from '#server/utils/redis/clusterLock'
import type { RowDataPacket, ResultSetHeader } from 'mysql2'

/** 每批处理的行数上限 */
const BATCH_SIZE = 100

export default defineNitroPlugin(() => {
  const startedAt = new Date()
  void (async () => {
    try {
      // 分布式锁（P4 缺口 #2）：多实例下两个实例同时启动会重复清理同一批游客行（重复 DELETE /
      // 重复 fileLog），锁保证同一启动周期仅一个实例执行；TTL 取宽值覆盖清理全程。
      await withClusterLock(
        'guest-cleanup',
        async () => {
          // 从 sys_config 读取游客数据保留天数，默认 180 天，最低 30 天
          const cfgRows = await query<{ config_value: string }>(
            "SELECT config_value FROM sys_config WHERE config_key = 'guest_retention_days'",
          )
          const rawDays = cfgRows[0] ? parseInt(cfgRows[0].config_value, 10) : 180
          const retentionDays = isNaN(rawDays) || rawDays < 30 ? 180 : rawDays

          logger.info(`[guestCleanup] 启动清理，保留天数=${retentionDays}`)
          await fileLog('db', 'info', `[guestCleanup] 启动清理，retentionDays=${retentionDays}`)

          // 阶段一：清理已合并的游客行
          const mergedCount = await cleanupMergedGuests(startedAt)

          // 阶段二：清理过期未合并的游客行
          const expiredCount = await cleanupExpiredGuests(startedAt, retentionDays)

          if (mergedCount > 0 || expiredCount > 0) {
            logger.info(`[guestCleanup] 清理完成：已合并=${mergedCount}行，过期=${expiredCount}行`)
          }
          await fileLog('db', 'info', `[guestCleanup] 清理完成`, {
            merged: mergedCount,
            expired: expiredCount,
          })
        },
        { ttlMs: 30 * 60 * 1000 },
      )
    } catch (err) {
      // 清理失败不阻塞服务启动
      logger.error('[guestCleanup] 启动清理失败:', err)
      await fileLog('db', 'error', '[guestCleanup] 启动清理失败', err)
    }
  })()
})

/**
 * 阶段一：批量删除已合并的游客行及其残留关联数据。
 * 合并时 progress/fav/recording 的 user_id 已迁移，但 checkin_log/checkin_stats 可能残留。
 */
async function cleanupMergedGuests(startedAt: Date): Promise<number> {
  let total = 0
  while (true) {
    const cleaned = await withTransaction(async (conn) => {
      // 取一批待清理的已合并游客行 id（只取启动前创建的，避免误删窗口期新行）
      const [guests] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM user
         WHERE is_guest = 1 AND merged_into_user_id IS NOT NULL AND createdAt < ?
         LIMIT ?`,
        [startedAt, BATCH_SIZE],
      )
      if (guests.length === 0) return 0
      const ids = guests.map((g) => g.id)

      // 删除残留关联数据
      await conn.execute(
        `DELETE FROM user_checkin_log WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      await conn.execute(
        `DELETE FROM user_checkin_stats WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      // 清理可能残留的录音、进度、收藏数据（合并时通常已迁移，兜底清理）
      await conn.execute(
        `DELETE FROM recording WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      await conn.execute(
        `DELETE FROM user_progress WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      await conn.execute(
        `DELETE FROM user_fav_segment WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      await conn.execute(
        `DELETE FROM user_fav_word WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      // P4-B1：连带清理评测鉴权发放记录（游客换证孤儿行，防表膨胀与全局闸门计数污染）
      await conn.execute(
        `DELETE FROM eval_auth_log WHERE user_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )

      // 物理删除游客行
      const [result] = await conn.execute<ResultSetHeader>(
        `DELETE FROM user WHERE id IN (${ids.map(() => '?').join(',')}) AND is_guest = 1 AND merged_into_user_id IS NOT NULL`,
        ids,
      )
      return result.affectedRows ?? 0
    })
    if (cleaned === 0) break
    total += cleaned
    if (cleaned < BATCH_SIZE) break
  }
  return total
}

/**
 * 阶段二：批量删除过期未合并的游客行及全部关联数据。
 * 过期判断：优先取 user_checkin_stats.updatedAt 作为最后活跃时间；
 * 无 stats 记录时回退到 user.createdAt。
 */
async function cleanupExpiredGuests(startedAt: Date, retentionDays: number): Promise<number> {
  let total = 0
  while (true) {
    const cleaned = await withTransaction(async (conn) => {
      // 取一批过期未合并游客行 id
      // 过期条件：
      //   - 有 stats 行：stats.updatedAt < 截止时间
      //   - 无 stats 行：user.createdAt < 截止时间
      // 截止时间 = NOW() - retentionDays 天，同时必须 < startedAt（保护启动窗口期新行）
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      const safeCutoff = cutoff < startedAt ? cutoff : startedAt

      const [guests] = await conn.query<RowDataPacket[]>(
        `SELECT u.id
         FROM user u
         LEFT JOIN user_checkin_stats s ON s.user_id = u.id
         WHERE u.is_guest = 1
           AND u.merged_into_user_id IS NULL
           AND u.createdAt < ?
           AND (
             (s.updatedAt IS NOT NULL AND s.updatedAt < ?)
             OR (s.updatedAt IS NULL AND u.createdAt < ?)
           )
         LIMIT ?`,
        [startedAt, safeCutoff, safeCutoff, BATCH_SIZE],
      )
      if (guests.length === 0) return 0
      const ids = guests.map((g) => g.id)
      const placeholders = ids.map(() => '?').join(',')

      // 删除所有关联数据
      await conn.execute(`DELETE FROM user_checkin_log WHERE user_id IN (${placeholders})`, ids)
      await conn.execute(`DELETE FROM user_checkin_stats WHERE user_id IN (${placeholders})`, ids)
      // 清理录音、学习进度、收藏数据
      await conn.execute(`DELETE FROM recording WHERE user_id IN (${placeholders})`, ids)
      await conn.execute(`DELETE FROM user_progress WHERE user_id IN (${placeholders})`, ids)
      await conn.execute(`DELETE FROM user_fav_segment WHERE user_id IN (${placeholders})`, ids)
      await conn.execute(`DELETE FROM user_fav_word WHERE user_id IN (${placeholders})`, ids)
      // P4-B1：连带清理评测鉴权发放记录（孤儿行随游客行一并删除）
      await conn.execute(`DELETE FROM eval_auth_log WHERE user_id IN (${placeholders})`, ids)

      // 物理删除游客行
      const [result] = await conn.execute<ResultSetHeader>(
        `DELETE FROM user WHERE id IN (${placeholders}) AND is_guest = 1 AND merged_into_user_id IS NULL`,
        ids,
      )
      return result.affectedRows ?? 0
    })
    if (cleaned === 0) break
    total += cleaned
    if (cleaned < BATCH_SIZE) break
  }
  return total
}
