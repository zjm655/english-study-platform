/**
 * 临时迁移：插入用户自定义材料单元 + segment 添加 is_public 字段
 * POST /api/migrate/prepare-custom
 *
 * 已完成（2026-07-16）。如需重新执行，取消注释即可。
 */
// import { pool } from '#server/utils/db'
// import type { ResultSetHeader } from 'mysql2'
//
// export default defineEventHandler(async (): Promise<ResPayload<{ results: string[] }>> => {
//   const results: string[] = []
//
//   try {
//     const [r] = await pool.execute<ResultSetHeader>(
//       `INSERT INTO unit (id, title, description, level, sort_order)
//        VALUES (0, '用户自定义材料', '此单元中的材料由用户上传。您可以在此查看自己上传的材料，以及他人上传并选择公开的材料。', 0, 0)
//        ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`
//     )
//     results.push(`插入/更新 unit(id=0): ${r.affectedRows > 0 ? '成功' : '已存在'}`)
//   } catch (err: any) {
//     results.push(`插入 unit(id=0) 失败: ${err.message}`)
//   }
//
//   try {
//     await pool.execute(
//       `ALTER TABLE segment ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否公开: 0不公开 1公开'`
//     )
//     results.push('segment.is_public 字段添加成功')
//   } catch (err: any) {
//     if (err?.errno === 1060) {
//       results.push('segment.is_public 字段已存在，跳过')
//     } else {
//       results.push(`segment.is_public 字段添加失败: ${err.message}`)
//     }
//   }
//
//   return { code: 200, message: '完成', data: { results } }
// })

// @deprecated 一次性数据迁移已完成，此端点已停用，调用返回 410 Gone。
export default defineEventHandler(() => {
  return validateError('迁移端点已禁用', 410)
})
