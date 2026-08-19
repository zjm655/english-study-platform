// server/services/redisBackup.ts
// 运维备份（P4 后续 spec 任务 3）：触发 Redis RDB 备份（BGSAVE）+ 返回备份状态。
// 仅触发 BGSAVE + 状态展示，不提供 RDB 文件下载——docker 部署下 RDB 文件位于 Redis 容器内，
// 与本服务存在跨容器文件系统边界，无法安全透出文件流。
// Redis 不可用（未配置/断连）抛业务错误，由接口层捕获后转 validateError（500）。
// 循环依赖规避（同 queueStore 先例）：redisConn 一律动态 import，避免与 alertEventLog 静态成环。
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 运维备份结果：是否已触发 + 最近一次成功保存距今秒数 + 是否进行中 + RDB 文件大小 */
export interface RedisBackupResult {
  triggered: boolean
  lastSaveAgoSec: number | null
  inProgress: boolean
  rdbSizeBytes: number | null
}

/**
 * 触发 Redis BGSAVE 并返回备份状态。
 * - Redis 不可用（未配置/断连）→ 抛业务错误（由接口转 validateError 500）。
 * - persistence 信息读取失败 → lastSaveAgoSec=null、inProgress=false（仍返回 triggered:true）。
 * - RDB 文件大小仅当 configGet 与 stat 均成功才返回，任一失败 → null（绝不抛错）。
 */
export async function triggerRedisBackup(): Promise<RedisBackupResult> {
  const { getRedis } = await import('#server/utils/redisConn')
  const client = getRedis()
  if (!client) throw new Error('Redis 未就绪（未配置或断连），无法触发备份')

  await client.bgSave()

  let lastSaveAgoSec: number | null = null
  let inProgress = false
  try {
    const info = await client.info('persistence')
    const lastSaveMatch = info.match(/^rdb_last_bgsave_time_sec:(\d+)/m)
    lastSaveAgoSec = lastSaveMatch ? Number(lastSaveMatch[1]) : null
    inProgress = /^rdb_bgsave_in_progress:1/m.test(info)
  } catch {
    // info 失败：状态回落默认值（null/false），备份触发结果不受影响
  }

  let rdbSizeBytes: number | null = null
  try {
    // node-redis configGet 返回键值对象：configGet('dir') → { dir: '...' }
    const dir = await client.configGet('dir')
    const dbfilename = await client.configGet('dbfilename')
    const dirValue = dir['dir']
    const filenameValue = dbfilename['dbfilename']
    if (dirValue && filenameValue) {
      const s = await stat(join(dirValue, filenameValue))
      rdbSizeBytes = s.size
    }
  } catch {
    // configGet / stat 任一失败：大小不可得，回落 null（不阻断备份触发）
    rdbSizeBytes = null
  }

  return { triggered: true, lastSaveAgoSec, inProgress, rdbSizeBytes }
}
