// server/api/admin/monitor/mysql.get.ts
// GET /api/admin/monitor/mysql — MySQL 运行时健康状态（运行监控页 MySQL 面板）。
// DB 不可达时服务内部降级为 online=false 返回，本端点始终返回 200，不抛错。
import { ensurePermission } from '#server/services/permission'
import { getMySqlMonitorResult } from '#server/services/mysqlMonitor'
import { validateSuccess } from '#server/utils/validate'
import { PERMISSIONS } from '#shared/utils/permission'
import type { MySqlMonitorResult } from '#shared/types/mysqlMonitor'

export default defineEventHandler(async (event): Promise<ResPayload<MySqlMonitorResult | null>> => {
  const err = ensurePermission(event, PERMISSIONS.CONFIG)
  if (err) return err
  return validateSuccess<MySqlMonitorResult>(await getMySqlMonitorResult())
})
