// server/api/admin/monitor/redis-backup.post.ts
// 运维备份（P4 后续 spec 任务 3）：触发 Redis RDB 备份并返回备份状态。
// POST /api/admin/monitor/redis-backup —— 仅超管 / 被显式授予 ops_backup 的管理员可调用。
import { ensurePermission } from '#server/services/permission'
import { triggerRedisBackup, type RedisBackupResult } from '#server/services/redisBackup'
import { validateSuccess, validateError } from '#server/utils/validate'
import { PERMISSIONS } from '#shared/utils/permission'
import type { ResPayload } from '#shared/types/request'

export default defineEventHandler(async (event): Promise<ResPayload<RedisBackupResult | null>> => {
  const err = ensurePermission(event, PERMISSIONS.OPS_BACKUP)
  if (err) return err
  try {
    return validateSuccess<RedisBackupResult>(await triggerRedisBackup())
  } catch (e) {
    return validateError(e instanceof Error ? e.message : '备份失败', 500)
  }
})
