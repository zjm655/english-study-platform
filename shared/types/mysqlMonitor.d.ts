/** GET /api/admin/monitor/mysql 返回的 MySQL 健康状态 */
export interface MySqlTableStat {
  name: string
  rows: number
  dataBytes: number
  indexBytes: number
}
export interface MySqlMonitorResult {
  /** 在线判定（SELECT 1 成功） */
  online: boolean
  version?: string
  /** 运行秒数 */
  uptimeSec?: number
  /** 当前连接数 Threads_connected */
  connections?: number
  /** 全局连接上限 max_connections */
  maxConnections?: number
  /** 峰值连接数 Max_used_connections */
  maxUsedConnections?: number
  /** 应用连接池上限（DB_POOL_LIMIT） */
  appPoolLimit?: number
  /** 数据库总大小（data_length+index_length，字节） */
  totalSizeBytes?: number
  tables?: MySqlTableStat[]
  /** DB 不可达时的失败摘要（online=false 时） */
  error?: string
}
