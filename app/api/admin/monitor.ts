import { adminMonitorPath, adminMySqlPath, adminRedisBackupPath } from '~/api/paths'
import type { AdminMonitorSnapshot } from '#shared/types/adminMonitor'
import type { MySqlMonitorResult } from '#shared/types/mysqlMonitor'

/** 运行监控聚合快照（队列水位/评测闸门/上传任务/埋点缓冲/限流滑窗/Redis） */
export const getAdminMonitor = () => request<AdminMonitorSnapshot>(adminMonitorPath)

/** Redis RDB 备份触发结果（与 server/services/redisBackup.ts 的 RedisBackupResult 对齐） */
export interface RedisBackupResult {
  triggered: boolean
  lastSaveAgoSec: number | null
  inProgress: boolean
  rdbSizeBytes: number | null
}

/** MySQL 运行时健康状态（运行监控页 MySQL 面板，独立于 5s 主轮询） */
export const getAdminMySql = () => request<MySqlMonitorResult>(adminMySqlPath)

/** 触发 Redis RDB 备份（运维备份，仅授予 ops_backup 权限可用） */
export const triggerRedisBackup = () =>
  request<RedisBackupResult>(adminRedisBackupPath, { method: 'POST' })
