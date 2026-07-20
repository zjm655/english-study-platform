// /**
//  * 临时迁移接口：将本地音频文件上传到 OSS 并更新数据库
//  *
//  * POST /api/migrate/oss-audio
//  *
//  * 迁移完成后请删除此文件，并移除 auth.ts 白名单中的对应路径。
//  */
// import { query } from '#server/utils/db'
// import { uploadWithKey } from '#server/utils/oss'
// import { parseFile } from 'music-metadata'
// import fs from 'node:fs'
// import path from 'node:path'

// // 项目根目录下的 public/audio/ 是音频文件的实际位置
// const AUDIO_BASE_DIR = path.resolve(process.cwd(), 'public')

// interface MigrateStats {
//   total: number
//   uploaded: number
//   skipped: number
//   failed: number
//   errors: string[]
// }

// /** 检查是否已迁移（audioUrl 已经是 https:// 开头） */
// function isMigrated(audioUrl: string | null): boolean {
//   if (!audioUrl) return true
//   return audioUrl.startsWith('https://')
// }

// /** 读取 MP3 文件时长（秒），失败返回 null */
// async function getDuration(filePath: string): Promise<number | null> {
//   try {
//     const metadata = await parseFile(filePath)
//     return metadata.format.duration ?? null
//   } catch {
//     return null
//   }
// }

// /** 迁移单张表 */
// async function migrateTable(
//   tableName: string,
//   audioUrlColumn: string,
//   buildOssKey: (audioUrl: string) => string
// ): Promise<MigrateStats> {
//   const rows = await query<{ id: number; audioUrl: string }>(
//     `SELECT id, ${audioUrlColumn} AS audioUrl FROM ${tableName} WHERE ${audioUrlColumn} IS NOT NULL AND ${audioUrlColumn} != ''`
//   )

//   const stats: MigrateStats = { total: rows.length, uploaded: 0, skipped: 0, failed: 0, errors: [] }

//   for (const row of rows) {
//     if (isMigrated(row.audioUrl)) {
//       stats.skipped++
//       continue
//     }

//     const localPath = path.join(AUDIO_BASE_DIR, row.audioUrl)

//     if (!fs.existsSync(localPath)) {
//       stats.skipped++
//       logger.warn(`[migrate] ${tableName}#${row.id} 文件不存在: ${localPath}`)
//       continue
//     }

//     try {
//       const fileBuffer = fs.readFileSync(localPath)
//       const ossKey = buildOssKey(row.audioUrl)
//       const { url } = await uploadWithKey(fileBuffer, ossKey)
//       const duration = await getDuration(localPath)

//       await query(
//         `UPDATE ${tableName} SET ${audioUrlColumn} = ?, duration = ? WHERE id = ?`,
//         [url, duration !== null ? duration.toFixed(2) : null, row.id]
//       )
//       stats.uploaded++
//     } catch (err) {
//       stats.failed++
//       const msg = err instanceof Error ? err.message : String(err)
//       stats.errors.push(`${tableName}#${row.id}: ${msg}`)
//       logger.error(`[migrate] ${tableName}#${row.id} 失败:`, msg)
//     }
//   }

//   return stats
// }

// export default defineEventHandler(async (): Promise<ResPayload<Record<string, MigrateStats>>> => {
//   logger.log('[migrate] 开始音频迁移到 OSS...')

//   const [segStats, wbStats, vocabStats] = await Promise.all([
//     // segment: audio/primary/xxx.mp3 → audio/segment/primary/xxx.mp3
//     migrateTable('segment', 'audioUrl', (url) => `audio/segment/${url.replace(/^audio\//, '')}`),

//     // word_bank: audio/word_bank/primary/xxx.mp3 → 保持原路径
//     migrateTable('word_bank', 'audioUrl', (url) => url),

//     // vocabulary: audio/word_bank/primary/xxx.mp3 → 与 word_bank 一致
//     migrateTable('vocabulary', 'audioUrl', (url) => url),
//   ])

//   // 打印汇总到服务端日志
//   const totalUploaded = segStats.uploaded + wbStats.uploaded + vocabStats.uploaded
//   const totalFailed = segStats.failed + wbStats.failed + vocabStats.failed
//   logger.log(`[migrate] 完成: 上传 ${totalUploaded} | 失败 ${totalFailed}`)

//   // 如果有任何失败，仍然返回 200 但在 message 中提示
//   const hasErrors = totalFailed > 0
//   const message = hasErrors
//     ? `迁移完成，但 ${totalFailed} 条失败，详见 errors 字段`
//     : '迁移完成'

//   return {
//     code: 200,
//     message,
//     data: {
//       segment: segStats,
//       word_bank: wbStats,
//       vocabulary: vocabStats,
//     },
//   }
// })

// @deprecated 一次性数据迁移已完成，此端点已停用，调用返回 410 Gone。
export default defineEventHandler(() => {
  return validateError('迁移端点已禁用', 410)
})