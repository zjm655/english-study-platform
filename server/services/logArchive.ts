// server/services/logArchive.ts
// 日志归档：把超期日志从原表迁入镜像归档表（logs/clean），归档表超期可彻底删除（logs/archive-purge）。
// 归档表结构见迁移 026_log_archive.sql：主键沿用原表 id（INSERT IGNORE 幂等），仅保留 idx_created_at。
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { query, withTransaction } from '#server/utils/db'

/** 归档配置：原表 → 归档表 + 显式列清单（防 SELECT * 列序漂移，archived_at 由 DEFAULT 填充） */
interface ArchiveTableCfg {
  archiveTable: string
  columns: string[]
}

/** 可归档表白名单（防注入：表名/列名均取自此处硬编码，不拼接外部输入）。
 * 列清单含历史 ALTER 追加列（006/008/009/022/023），新增列时需同步改此处与归档表 DDL */
export const ARCHIVABLE_TABLES: Record<string, ArchiveTableCfg> = {
  api_call_log: {
    archiveTable: 'api_call_log_archive',
    columns: [
      'id',
      'path',
      'route_pattern',
      'method',
      'status_code',
      'business_code',
      'duration_ms',
      'user_id',
      'ip',
      'request_id',
      'error_message',
      'error_stack',
      'createdAt',
    ],
  },
  cloud_service_call_log: {
    archiveTable: 'cloud_service_call_log_archive',
    columns: [
      'id',
      'service',
      'operation',
      'request_id',
      'success',
      'duration_ms',
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'biz_duration_ms',
      'error_message',
      'createdAt',
    ],
  },
  admin_operation_log: {
    archiveTable: 'admin_operation_log_archive',
    columns: ['id', 'admin_id', 'action', 'target_type', 'target_id', 'detail', 'createdAt'],
  },
}

/** 每批迁移/删除行数（与原 clean 分批策略一致，避免长事务锁表） */
const BATCH_SIZE = 10000
/** 批次间隔，降低锁竞争 */
const BATCH_INTERVAL_MS = 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function requireCfg(table: string): ArchiveTableCfg {
  const cfg = ARCHIVABLE_TABLES[table]
  if (!cfg) throw new Error(`不支持归档的表名: ${table}`)
  return cfg
}

/**
 * 把 days 天前的日志分批迁入归档表并从原表删除，返回累计迁移行数。
 *
 * 每批在一个事务内完成「锁定 id 集合 → INSERT IGNORE 入档 → 按同一 id 集合 DELETE」，
 * 保证入档与删除原子；中断重跑时 INSERT IGNORE 依主键去重，不会产生重复归档。
 */
export async function archiveLogs(table: string, days: number): Promise<number> {
  const cfg = requireCfg(table)
  const cols = cfg.columns.map((c) => `\`${c}\``).join(', ')
  let total = 0

  for (;;) {
    const moved = await withTransaction(async (conn: PoolConnection) => {
      // 1. 先锁定本批 id 集合：INSERT 与 DELETE 用同一集合，避免两条 LIMIT 语句选中不同行
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM \`${table}\` WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ${BATCH_SIZE}`,
        [days],
      )
      const ids = rows.map((r) => r.id as number)
      if (ids.length === 0) return 0

      const placeholders = ids.map(() => '?').join(',')
      // 2. 入档（IGNORE：主键冲突视为已归档，幂等）
      await conn.query(
        `INSERT IGNORE INTO \`${cfg.archiveTable}\` (${cols}) SELECT ${cols} FROM \`${table}\` WHERE id IN (${placeholders})`,
        ids,
      )
      // 3. 按同一 id 集合从原表删除
      await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${placeholders})`, ids)
      return ids.length
    })

    total += moved
    if (moved < BATCH_SIZE) break
    await sleep(BATCH_INTERVAL_MS)
  }

  return total
}

/**
 * 彻底删除归档表中原始日志时间（createdAt，非 archived_at）早于 days 天的行，
 * 分批 DELETE，返回累计删除行数。不可恢复，调用方必须做二次确认与审计留痕。
 */
export async function purgeArchive(table: string, days: number): Promise<number> {
  const cfg = requireCfg(table)
  let total = 0
  let affected = BATCH_SIZE

  while (affected === BATCH_SIZE) {
    const result = await query<ResultSetHeader>(
      `DELETE FROM \`${cfg.archiveTable}\` WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ${BATCH_SIZE}`,
      [days],
    )
    affected = Number((result as unknown as ResultSetHeader).affectedRows ?? 0)
    total += affected
    if (affected === BATCH_SIZE) {
      await sleep(BATCH_INTERVAL_MS)
    }
  }

  return total
}
