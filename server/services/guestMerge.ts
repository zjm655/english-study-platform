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
export async function mergeGuestData(guestKey: string, targetUserId: number, fingerprint?: string | null): Promise<void> {
  await withTransaction(async (conn) => {
    // 1. 定位未合并的游客行（FOR UPDATE 防并发合并）
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, fingerprint_hash FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL FOR UPDATE',
      [guestKey],
    )
    const guestRow = rows[0] as { id: number; fingerprint_hash: string | null } | undefined
    if (!guestRow) return // 无游客行 / 已合并 → 幂等 return
    const guestId = guestRow.id
    if (guestId === targetUserId) return // 防自合并（防御性，理论不发生）

    // 1b. 查找指纹关联的另一个游客行（历史双通道产生的孤儿行）
    // 优先用调用方传入的 fingerprint（从请求 header 透传），兜底用 guest_key 行上的 fingerprint_hash
    let fingerprintGuestId: number | null = null
    const fpHash = fingerprint ?? guestRow.fingerprint_hash
    if (fpHash) {
      const [fpRows] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM user WHERE fingerprint_hash = ? AND id != ? AND is_guest = 1 AND merged_into_user_id IS NULL FOR UPDATE',
        [fpHash, guestId],
      )
      if ((fpRows as { id: number }[]).length > 0) {
        fingerprintGuestId = (fpRows[0] as { id: number }).id
      }
    }

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

    // 5. 合并学习进度：同 (user_id, segment_id) 取优，done 字段取 OR，score 字段取 GREATEST
    const [progRes] = await conn.execute<ResultSetHeader>(
      `INSERT INTO user_progress (user_id, segment_id, phase1_done, phase2_done, phase3_done, phase3_score, phase4_done, phase4_score)
       SELECT ?, segment_id, phase1_done, phase2_done, phase3_done, phase3_score, phase4_done, phase4_score
       FROM user_progress WHERE user_id = ? AND deleted_at IS NULL
       ON DUPLICATE KEY UPDATE
         phase1_done = phase1_done OR VALUES(phase1_done),
         phase2_done = phase2_done OR VALUES(phase2_done),
         phase3_done = phase3_done OR VALUES(phase3_done),
         phase3_score = IFNULL(GREATEST(IFNULL(phase3_score, 0), IFNULL(VALUES(phase3_score), 0)), phase3_score),
         phase4_done = phase4_done OR VALUES(phase4_done),
         phase4_score = IFNULL(GREATEST(IFNULL(phase4_score, 0), IFNULL(VALUES(phase4_score), 0)), phase4_score)`,
      [targetUserId, guestId],
    )

    // 6. 合并片段收藏：并集，已存在则跳过（唯一索引 uk_user_segment 保证不重复）
    const [favSegRes] = await conn.execute<ResultSetHeader>(
      `INSERT IGNORE INTO user_fav_segment (user_id, segment_id, createdAt)
       SELECT ?, segment_id, createdAt
       FROM user_fav_segment WHERE user_id = ? AND deleted_at IS NULL`,
      [targetUserId, guestId],
    )

    // 7. 合并单词收藏：并集，已存在则跳过（唯一索引 uk_user_vocab 保证不重复）
    const [favWordRes] = await conn.execute<ResultSetHeader>(
      `INSERT IGNORE INTO user_fav_word (user_id, vocabulary_id, createdAt)
       SELECT ?, vocabulary_id, createdAt
       FROM user_fav_word WHERE user_id = ? AND deleted_at IS NULL`,
      [targetUserId, guestId],
    )

    // 8. 迁移录音：直接将游客录音的 user_id 改为目标用户
    const [recRes] = await conn.execute<ResultSetHeader>(
      'UPDATE recording SET user_id = ? WHERE user_id = ? AND deleted_at IS NULL',
      [targetUserId, guestId],
    )

    // 8b. 合并指纹关联游客行的数据（历史双通道产生的孤儿行）
    let fpRecCount = 0
    if (fingerprintGuestId) {
      // 迁移指纹游客行的录音
      const [fpRecRes] = await conn.execute<ResultSetHeader>(
        'UPDATE recording SET user_id = ? WHERE user_id = ? AND deleted_at IS NULL',
        [targetUserId, fingerprintGuestId],
      )
      fpRecCount = fpRecRes.affectedRows ?? 0
      // 迁移进度（取优）
      await conn.execute(
        `INSERT INTO user_progress (user_id, segment_id, phase1_done, phase2_done, phase3_done, phase3_score, phase4_done, phase4_score)
         SELECT ?, segment_id, phase1_done, phase2_done, phase3_done, phase3_score, phase4_done, phase4_score
         FROM user_progress WHERE user_id = ? AND deleted_at IS NULL
         ON DUPLICATE KEY UPDATE
           phase1_done = phase1_done OR VALUES(phase1_done),
           phase2_done = phase2_done OR VALUES(phase2_done),
           phase3_done = phase3_done OR VALUES(phase3_done),
           phase3_score = IFNULL(GREATEST(IFNULL(phase3_score, 0), IFNULL(VALUES(phase3_score), 0)), phase3_score),
           phase4_done = phase4_done OR VALUES(phase4_done),
           phase4_score = IFNULL(GREATEST(IFNULL(phase4_score, 0), IFNULL(VALUES(phase4_score), 0)), phase4_score)`,
        [targetUserId, fingerprintGuestId],
      )
      // 迁移收藏（并集，已存在则跳过）
      await conn.execute(
        `INSERT IGNORE INTO user_fav_segment (user_id, segment_id, createdAt)
         SELECT ?, segment_id, createdAt FROM user_fav_segment WHERE user_id = ? AND deleted_at IS NULL`,
        [targetUserId, fingerprintGuestId],
      )
      await conn.execute(
        `INSERT IGNORE INTO user_fav_word (user_id, vocabulary_id, createdAt)
         SELECT ?, vocabulary_id, createdAt FROM user_fav_word WHERE user_id = ? AND deleted_at IS NULL`,
        [targetUserId, fingerprintGuestId],
      )
      // 迁移签到日志（同日累加）
      await conn.execute(
        `INSERT INTO user_checkin_log (user_id, checkin_date, checked_in, study_seconds, segments_completed)
         SELECT ?, checkin_date, checked_in, study_seconds, segments_completed
         FROM user_checkin_log WHERE user_id = ?
         ON DUPLICATE KEY UPDATE
           study_seconds = study_seconds + VALUES(study_seconds),
           checked_in = GREATEST(checked_in, VALUES(checked_in)),
           segments_completed = segments_completed + VALUES(segments_completed)`,
        [targetUserId, fingerprintGuestId],
      )
      // 累加汇总学习时长
      await conn.execute(
        `UPDATE user_checkin_stats t
         JOIN user_checkin_stats g ON g.user_id = ?
         SET t.total_study_seconds = t.total_study_seconds + g.total_study_seconds
         WHERE t.user_id = ?`,
        [fingerprintGuestId, targetUserId],
      )
      // 标记指纹游客行为已合并
      await conn.execute(
        'UPDATE user SET merged_into_user_id = ?, deleted_at = NOW() WHERE id = ? AND merged_into_user_id IS NULL',
        [targetUserId, fingerprintGuestId],
      )
    }

    // 9. 合并统计日志
    logger.info(
      `[guestMerge] 游客 ${guestId} → 用户 ${targetUserId} 合并完成: ` +
      `progress=${progRes.affectedRows}, fav_segment=${favSegRes.affectedRows}, ` +
      `fav_word=${favWordRes.affectedRows}, recording=${recRes.affectedRows}` +
      (fingerprintGuestId ? `, fp_guest=${fingerprintGuestId}, fp_recording=${fpRecCount}` : ''),
    )
  })
}

/**
 * 合并指纹孤儿游客行到目标用户（注册转正后调用）。
 * 与 mergeGuestData 步骤 8b 逻辑对称，独立事务，失败不阻断注册流程。
 */
export async function mergeFingerprintOrphan(fingerprint: string, targetUserId: number): Promise<void> {
  await withTransaction(async (conn) => {
    const [fpRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM user WHERE fingerprint_hash = ? AND id != ? AND is_guest = 1 AND merged_into_user_id IS NULL FOR UPDATE',
      [fingerprint, targetUserId],
    )
    if ((fpRows as { id: number }[]).length === 0) return
    const orphanId = (fpRows[0] as { id: number }).id

    // 迁移录音
    await conn.execute('UPDATE recording SET user_id = ? WHERE user_id = ? AND deleted_at IS NULL', [targetUserId, orphanId])
    // 迁移进度（取优）
    await conn.execute(
      `INSERT INTO user_progress (user_id, segment_id, phase1_done, phase2_done, phase3_done, phase3_score, phase4_done, phase4_score)
       SELECT ?, segment_id, phase1_done, phase2_done, phase3_done, phase3_score, phase4_done, phase4_score
       FROM user_progress WHERE user_id = ? AND deleted_at IS NULL
       ON DUPLICATE KEY UPDATE
         phase1_done = phase1_done OR VALUES(phase1_done),
         phase2_done = phase2_done OR VALUES(phase2_done),
         phase3_done = phase3_done OR VALUES(phase3_done),
         phase3_score = IFNULL(GREATEST(IFNULL(phase3_score, 0), IFNULL(VALUES(phase3_score), 0)), phase3_score),
         phase4_done = phase4_done OR VALUES(phase4_done),
         phase4_score = IFNULL(GREATEST(IFNULL(phase4_score, 0), IFNULL(VALUES(phase4_score), 0)), phase4_score)`,
      [targetUserId, orphanId],
    )
    // 迁移收藏
    await conn.execute(
      'INSERT IGNORE INTO user_fav_segment (user_id, segment_id, createdAt) SELECT ?, segment_id, createdAt FROM user_fav_segment WHERE user_id = ? AND deleted_at IS NULL',
      [targetUserId, orphanId],
    )
    await conn.execute(
      'INSERT IGNORE INTO user_fav_word (user_id, vocabulary_id, createdAt) SELECT ?, vocabulary_id, createdAt FROM user_fav_word WHERE user_id = ? AND deleted_at IS NULL',
      [targetUserId, orphanId],
    )
    // 迁移签到日志
    await conn.execute(
      `INSERT INTO user_checkin_log (user_id, checkin_date, checked_in, study_seconds, segments_completed)
       SELECT ?, checkin_date, checked_in, study_seconds, segments_completed FROM user_checkin_log WHERE user_id = ?
       ON DUPLICATE KEY UPDATE study_seconds = study_seconds + VALUES(study_seconds), checked_in = GREATEST(checked_in, VALUES(checked_in)), segments_completed = segments_completed + VALUES(segments_completed)`,
      [targetUserId, orphanId],
    )
    // 累加学习时长
    await conn.execute(
      'UPDATE user_checkin_stats t JOIN user_checkin_stats g ON g.user_id = ? SET t.total_study_seconds = t.total_study_seconds + g.total_study_seconds WHERE t.user_id = ?',
      [orphanId, targetUserId],
    )
    // 标记已合并
    await conn.execute(
      'UPDATE user SET merged_into_user_id = ?, deleted_at = NOW() WHERE id = ? AND merged_into_user_id IS NULL',
      [targetUserId, orphanId],
    )
    logger.info(`[guestMerge] 指纹孤儿行 ${orphanId} → 用户 ${targetUserId} 合并完成`)
  })
}
