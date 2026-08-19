import { triggerRedisBackup, type RedisBackupResult } from '~/api/admin/monitor'

/** 触发 Redis RDB 备份（运维备份，前端按钮按 ops_backup 权限显隐） */
export const useAdminRedisBackup = () => {
  const cfg = createResCfg<null, RedisBackupResult>({
    handle: () => triggerRedisBackup(),
    success: '已触发 RDB 备份',
    clientFail: '触发 RDB 备份失败',
    serverFail: '服务器异常，触发备份失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
