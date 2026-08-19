// server/services/mysqlMonitor.ts
// MySQL 运行时健康状态读取（运行监控页 MySQL 面板数据源）。
// 说明：全部读包在单个 try/catch 内，任一查询失败即整体降级 online=false 并附错误摘要，
// 绝不向上抛错——监控端点本身不能被 DB 故障拖垮（降级而非抛异常）。
import { query, DB_POOL_LIMIT } from '#server/utils/db'
import type { MySqlMonitorResult, MySqlTableStat } from '#shared/types/mysqlMonitor'

/** VERSION() 结果行 */
interface VersionRow {
  v: string
}

/** SHOW GLOBAL STATUS / VARIABLES 结果行（Variable_name/Value 为 MySQL 原始形态） */
interface StatusVariableRow {
  Variable_name: string
  Value: string | number
}

/** information_schema.TABLES 结果行（列名恒为大写） */
interface TableSizeRow {
  TABLE_NAME: string
  TABLE_ROWS: number | string | null
  DATA_LENGTH: number | string | null
  INDEX_LENGTH: number | string | null
}

/** 从 SHOW GLOBAL STATUS/VARIABLES 行中取指定变量值（找不到返回 undefined） */
function pickValue(rows: StatusVariableRow[], name: string): string | undefined {
  const hit = rows.find((r) => r.Variable_name === name)
  return hit === undefined ? undefined : String(hit.Value)
}

/** 将服务端返回的字符串/数字归一为 number（缺失或不可解析返回 undefined） */
function toNumberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isNaN(n) ? undefined : n
}

/**
 * 读取 MySQL 运行时健康状态（运行监控页 MySQL 面板）。
 * 一次调用内依次读取：版本 / 运行状态 / 全局变量 / 各表大小，并汇总 totalSizeBytes。
 */
export async function getMySqlMonitorResult(): Promise<MySqlMonitorResult> {
  try {
    const versionRows = await query<VersionRow>('SELECT VERSION() AS v')
    const statusRows = await query<StatusVariableRow>(
      `SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime', 'Threads_connected', 'Max_used_connections')`,
    )
    const variableRows = await query<StatusVariableRow>(
      `SHOW GLOBAL VARIABLES WHERE Variable_name = 'max_connections'`,
    )
    const tableRows = await query<TableSizeRow>(
      `SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
    )

    const tables: MySqlTableStat[] = tableRows.map((r) => ({
      name: r.TABLE_NAME,
      rows: Number(r.TABLE_ROWS ?? 0),
      dataBytes: Number(r.DATA_LENGTH ?? 0),
      indexBytes: Number(r.INDEX_LENGTH ?? 0),
    }))

    const totalSizeBytes = tables.reduce((sum, t) => sum + t.dataBytes + t.indexBytes, 0)

    return {
      online: true,
      version: versionRows[0]?.v,
      uptimeSec: toNumberOrUndefined(pickValue(statusRows, 'Uptime')),
      connections: toNumberOrUndefined(pickValue(statusRows, 'Threads_connected')),
      maxUsedConnections: toNumberOrUndefined(pickValue(statusRows, 'Max_used_connections')),
      maxConnections: toNumberOrUndefined(pickValue(variableRows, 'max_connections')),
      appPoolLimit: DB_POOL_LIMIT,
      totalSizeBytes,
      tables,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { online: false, error: message || 'MySQL 不可用' }
  }
}
