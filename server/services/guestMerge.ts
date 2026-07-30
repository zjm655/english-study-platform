// server/services/guestMerge.ts
// 老用户登录时把游客数据合并进其正式账户（跨行合并）。
//
// 幂等保证：事务内先置 merged_into_user_id latch（affectedRows 判并发抢占/重复），
// 后搬数据。崩溃回滚则 latch 未置、下次登录自动重试；成功则重复调用在 latch 处短路，
// 累加类操作（total_study_seconds）由 latch 保证 at-most-once。合并失败不阻断登录（调用方 catch）。
import { withTransaction } from '#server/utils/db'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'

/**
 * 合并游客数据到目标正式账户。幂等、失败可安全重试。
 * @param guestKey     游客 JWT 键
 * @param targetUserId 目标正式账户 id
 */
export async function mergeGuestData(guestKey: string, targetUserId: number): Promise<void> {
  await withTransaction(async (conn) => {
    // 1. 定位未合并的游客行（FOR UPDATE 防并发合并）
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL FOR UPDATE',
      [guestKey],
    )
    const guestRow = rows[0] as { id: number } | undefined
    if (!guestRow) return // 无游客行 / 已合并 → 幂等 return
    const guestId = guestRow.id
    if (guestId === targetUserId) return // 防自合并（防御性，理论不发生）

    // 2. latch：置合并标志 + 软删游客行（affectedRows=0 表示并发已抢占，幂等 return）
    const [upd] = await conn.execute<ResultSetHeader>(
      'UPDATE user SET merged_into_user_id = ?, deleted_at = NOW() WHERE id = ? AND merged_into_user_id IS NULL',
      [targetUserId, guestId],
    )
    if (upd.affectedRows === 0) return

    // 3. 合并按天学习日志：同日累加时长、取优签到标志、累加完成片段
    //    （游客行已软删但 log 行仍在，latch 已保证本段 at-most-once，无需删游客 log）
    await conn.execute(
      `INSERT INTO user_checkin_log (user_id, checkin_date, checked_in, study_seconds, segments_completed)
       SELECT ?, checkin_date, checked_in, study_seconds, segments_completed
       FROM user_checkin_log WHERE user_id = ?
       ON DUPLICATE KEY UPDATE
         study_seconds = study_seconds + VALUES(study_seconds),
         checked_in = GREATEST(checked_in, VALUES(checked_in)),
         segments_completed = segments_completed + VALUES(segments_completed)`,
      [targetUserId, guestId],
    )

    // 4. 累加汇总学习时长（游客有 stats 行才 JOIN 成功；一期签到天数/连续天数游客恒 0，不动）
    await conn.execute(
      `UPDATE user_checkin_stats t
       JOIN user_checkin_stats g ON g.user_id = ?
       SET t.total_study_seconds = t.total_study_seconds + g.total_study_seconds
       WHERE t.user_id = ?`,
      [guestId, targetUserId],
    )

    // 二期（开放盲听/学习后）在此同事务追加：
    // - user_progress：同 segment ON DUPLICATE KEY 取优（phaseN_done OR / phaseN_score GREATEST）
    // - 收藏（user_fav_segment/user_fav_word）：INSERT IGNORE ... SELECT 并集
    // - recording：UPDATE user_id 迁移
  })
}
