/**
 * 临时迁移：为业务表新增 media_id 字段并填充关联
 * POST /api/migrate/alter-media
 *
 * 执行完成后请注释此文件代码。
 *
 * [已执行完毕 - 2026-07-16]
 */
// import { pool } from '#server/utils/db'
// import type { ResultSetHeader } from 'mysql2'
//
// interface AlterResult {
//   step: string
//   sql: string
//   success: boolean
//   affected?: number
//   error?: string
// }
//
// export default defineEventHandler(async (): Promise<ResPayload<AlterResult[]>> => {
//   const results: AlterResult[] = []
//
//   // ====== 1. 新增字段 ======
//   const addColumns = [
//     `ALTER TABLE segment ADD COLUMN media_id INT DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)'`,
//     `ALTER TABLE vocabulary ADD COLUMN media_id INT DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)'`,
//     `ALTER TABLE word_bank ADD COLUMN media_id INT DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)'`,
//     `ALTER TABLE recording ADD COLUMN media_id INT DEFAULT NULL COMMENT '关联的媒体资源ID (media.id)'`,
//     `ALTER TABLE unit ADD COLUMN cover_media_id INT DEFAULT NULL COMMENT '关联的封面媒体资源ID (media.id)'`,
//   ]
//
//   for (const sql of addColumns) {
//     try {
//       await pool.execute(sql)
//       results.push({ step: 'add_column', sql: sql.substring(0, 60), success: true })
//       logger.log(`[alter-media] 字段添加成功: ${sql.substring(0, 60)}...`)
//     } catch (err: any) {
//       if (err?.errno === 1060) {
//         results.push({ step: 'add_column', sql: sql.substring(0, 60), success: true, affected: 0 })
//         logger.log(`[alter-media] 字段已存在，跳过: ${sql.substring(0, 60)}...`)
//       } else {
//         results.push({ step: 'add_column', sql: sql.substring(0, 60), success: false, error: err?.message })
//         logger.error(`[alter-media] 字段添加失败:`, err?.message)
//       }
//     }
//   }
//
//   // ====== 2. 填充关联 ======
//   const updates = [
//     {
//       name: 'segment.media_id',
//       sql: `UPDATE segment s
//             INNER JOIN media m ON m.object_key = SUBSTRING(s.audioUrl, LOCATE('.aliyuncs.com/', s.audioUrl) + 14) AND m.type = 'segment_audio'
//             SET s.media_id = m.id
//             WHERE s.audioUrl IS NOT NULL AND s.audioUrl != '' AND s.audioUrl LIKE 'https://%'`,
//     },
//     {
//       name: 'vocabulary.media_id',
//       sql: `UPDATE vocabulary v
//             INNER JOIN media m ON m.object_key = SUBSTRING(v.audioUrl, LOCATE('.aliyuncs.com/', v.audioUrl) + 14) AND m.type = 'vocab_audio'
//             SET v.media_id = m.id
//             WHERE v.audioUrl IS NOT NULL AND v.audioUrl != '' AND v.audioUrl LIKE 'https://%'`,
//     },
//     {
//       name: 'word_bank.media_id',
//       sql: `UPDATE word_bank w
//             INNER JOIN media m ON m.object_key = SUBSTRING(w.audioUrl, LOCATE('.aliyuncs.com/', w.audioUrl) + 14) AND m.type = 'word_audio'
//             SET w.media_id = m.id
//             WHERE w.audioUrl IS NOT NULL AND w.audioUrl != '' AND w.audioUrl LIKE 'https://%'`,
//     },
//     {
//       name: 'recording.media_id',
//       sql: `UPDATE recording r
//             INNER JOIN media m ON m.object_key = SUBSTRING(r.audioPath, LOCATE('.aliyuncs.com/', r.audioPath) + 14) AND m.type = 'recording'
//             SET r.media_id = m.id
//             WHERE r.audioPath IS NOT NULL AND r.audioPath != '' AND r.audioPath LIKE 'https://%'`,
//     },
//     {
//       name: 'unit.cover_media_id',
//       sql: `UPDATE unit u
//             INNER JOIN media m ON m.object_key = SUBSTRING(u.coverUrl, LOCATE('.aliyuncs.com/', u.coverUrl) + 14) AND m.type = 'cover'
//             SET u.cover_media_id = m.id
//             WHERE u.coverUrl IS NOT NULL AND u.coverUrl != '' AND u.coverUrl LIKE 'https://%'`,
//     },
//   ]
//
//   for (const up of updates) {
//     try {
//       const [result] = await pool.execute<ResultSetHeader>(up.sql)
//       results.push({
//         step: `update_${up.name}`,
//         sql: up.name,
//         success: true,
//         affected: result.affectedRows,
//       })
//       logger.log(`[alter-media] ${up.name} 更新 ${result.affectedRows} 条`)
//     } catch (err: any) {
//       results.push({
//         step: `update_${up.name}`,
//         sql: up.name,
//         success: false,
//         error: err?.message,
//       })
//       logger.error(`[alter-media] ${up.name} 失败:`, err?.message)
//     }
//   }
//
//   return {
//     code: 200,
//     message: '字段添加和关联填充完成',
//     data: results,
//   }
// })

export default defineEventHandler(() => {
  return validateError('迁移端点已禁用', 410)
})
