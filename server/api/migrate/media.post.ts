/**
 * 临时迁移接口：将现有业务表中的音频/图片信息迁移到 media 表
 *
 * POST /api/migrate/media
 *
 * 迁移已完成（2026-07-16），此文件已废弃。如需重新执行，取消注释即可。
 */
// import { query } from '#server/utils/db'
//
// interface MigrateStats {
//   table: string
//   total: number
//   migrated: number
//   skipped: number
//   failed: number
//   errors: string[]
// }
//
// interface SourceConfig {
//   table: string
//   urlColumn: string
//   durationColumn: string
//   mediaType: string
//   idColumn: string
// }
//
// /** 从 OSS URL 解析 bucket 和 object_key */
// function parseOssUrl(url: string): { bucket: string; objectKey: string } | null {
//   if (!url || !url.startsWith('https://')) return null
//
//   try {
//     const urlObj = new URL(url)
//     const host = urlObj.hostname
//     const ossIdx = host.indexOf('.oss')
//     if (ossIdx === -1) return null
//     const bucket = host.substring(0, ossIdx)
//     const objectKey = urlObj.pathname.substring(1)
//     return { bucket, objectKey }
//   } catch {
//     return null
//   }
// }
//
// /** 从文件名推断 MIME 类型 */
// function guessMimeType(fileName: string): string | null {
//   const ext = fileName.split('.').pop()?.toLowerCase()
//   const map: Record<string, string> = {
//     mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
//     m4a: 'audio/mp4', webm: 'audio/webm',
//     png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
//     gif: 'image/gif', webp: 'image/webp',
//   }
//   return ext ? map[ext] ?? null : null
// }
//
// /** 检查 media 表中是否已存在该 object_key */
// async function existsInMedia(objectKey: string): Promise<boolean> {
//   const rows = await query<{ count: number }>(
//     'SELECT COUNT(*) as count FROM media WHERE object_key = ?',
//     [objectKey]
//   )
//   return (rows[0]?.count ?? 0) > 0
// }
//
// /** 迁移单张表 */
// async function migrateTable(cfg: SourceConfig): Promise<MigrateStats> {
//   const stats: MigrateStats = { table: cfg.table, total: 0, migrated: 0, skipped: 0, failed: 0, errors: [] }
//
//   const rows = await query<{ id: number; url: string; duration: string | null }>(
//     `SELECT ${cfg.idColumn} as id, ${cfg.urlColumn} as url, ${cfg.durationColumn} as duration
//      FROM ${cfg.table}
//      WHERE ${cfg.urlColumn} IS NOT NULL AND ${cfg.urlColumn} != ''`
//   )
//
//   stats.total = rows.length
//
//   for (const row of rows) {
//     const parsed = parseOssUrl(row.url)
//     if (!parsed) { stats.skipped++; continue }
//     if (await existsInMedia(parsed.objectKey)) { stats.skipped++; continue }
//
//     try {
//       await query(
//         `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, duration, status)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         [null, cfg.mediaType, 'oss', parsed.bucket, parsed.objectKey,
//          parsed.objectKey.split('/').pop() ?? null, guessMimeType(parsed.objectKey), row.duration, 1]
//       )
//       stats.migrated++
//     } catch (err) {
//       stats.failed++
//       stats.errors.push(`${cfg.table}#${row.id}: ${err instanceof Error ? err.message : String(err)}`)
//     }
//   }
//
//   return stats
// }
//
// export default defineEventHandler(async (): Promise<ResPayload<Record<string, MigrateStats>>> => {
//   const results: Record<string, MigrateStats> = {}
//
//   results.segment = await migrateTable({ table: 'segment', urlColumn: 'audioUrl', durationColumn: 'duration', mediaType: 'segment_audio', idColumn: 'id' })
//   results.vocabulary = await migrateTable({ table: 'vocabulary', urlColumn: 'audioUrl', durationColumn: 'duration', mediaType: 'vocab_audio', idColumn: 'id' })
//   results.word_bank = await migrateTable({ table: 'word_bank', urlColumn: 'audioUrl', durationColumn: 'duration', mediaType: 'word_audio', idColumn: 'id' })
//   results.recording = await migrateTable({ table: 'recording', urlColumn: 'audioPath', durationColumn: 'duration', mediaType: 'recording', idColumn: 'id' })
//
//   // unit 封面图无 duration 字段，单独处理
//   const coverStats: MigrateStats = { table: 'unit', total: 0, migrated: 0, skipped: 0, failed: 0, errors: [] }
//   const coverRows = await query<{ id: number; coverUrl: string }>(
//     `SELECT id, coverUrl FROM unit WHERE coverUrl IS NOT NULL AND coverUrl != ''`
//   )
//   coverStats.total = coverRows.length
//   for (const row of coverRows) {
//     const parsed = parseOssUrl(row.coverUrl)
//     if (!parsed) { coverStats.skipped++; continue }
//     if (await existsInMedia(parsed.objectKey)) { coverStats.skipped++; continue }
//     try {
//       await query(
//         `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, status)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//         [null, 'cover', 'oss', parsed.bucket, parsed.objectKey,
//          parsed.objectKey.split('/').pop() ?? null, guessMimeType(parsed.objectKey), 1]
//       )
//       coverStats.migrated++
//     } catch (err) {
//       coverStats.failed++
//       coverStats.errors.push(`unit#${row.id}: ${err instanceof Error ? err.message : String(err)}`)
//     }
//   }
//   results.unit = coverStats
//
//   const totalMigrated = Object.values(results).reduce((sum, s) => sum + s.migrated, 0)
//   const totalFailed = Object.values(results).reduce((sum, s) => sum + s.failed, 0)
//   logger.log(`[migrate-media] 完成: 迁移 ${totalMigrated} | 失败 ${totalFailed}`)
//
//   return {
//     code: 200,
//     message: totalFailed > 0 ? `迁移完成，但 ${totalFailed} 条失败` : '迁移完成',
//     data: results,
//   }
// })

// @deprecated 一次性数据迁移已完成，此端点已停用，调用返回 410 Gone。
export default defineEventHandler(() => {
  return validateError('迁移端点已禁用', 410)
})
