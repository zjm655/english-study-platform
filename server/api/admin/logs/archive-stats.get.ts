import { query } from '#server/utils/db'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { ARCHIVABLE_TABLES } from '#server/services/logArchive'
import { PERMISSIONS } from '#shared/utils/permission'
import type { LogArchiveStatsItem } from '#shared/types/adminLogs'

/**
 * 三张日志归档表的统计（行数 + 原始日志时间范围），供日志子页归档区块展示
 * GET /api/admin/logs/archive-stats
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err

  const items: LogArchiveStatsItem[] = await Promise.all(
    Object.entries(ARCHIVABLE_TABLES).map(async ([table, cfg]) => {
      const rows = await query<{ total: number; oldest: string | null; newest: string | null }>(
        `SELECT COUNT(*) AS total, MIN(createdAt) AS oldest, MAX(createdAt) AS newest FROM \`${cfg.archiveTable}\``,
      )
      return {
        table,
        rows: Number(rows[0]?.total ?? 0),
        oldest: rows[0]?.oldest ?? null,
        newest: rows[0]?.newest ?? null,
      }
    }),
  )

  return validateSuccess({ items }, '获取归档统计成功')
})
