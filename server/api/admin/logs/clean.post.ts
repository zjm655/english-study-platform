import { readBody } from 'h3'
import { validateError, validateSuccess } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { archiveLogs, ARCHIVABLE_TABLES } from '#server/services/logArchive'
import { PERMISSIONS } from '#shared/utils/permission'
import { z } from 'zod'

const cleanSchema = z.object({
  table: z.string(),
  days: z.coerce.number().min(7, '至少保留 7 天数据').max(365, '最多归档 365 天前数据'),
})

/**
 * 管理员按时间范围归档清理日志：分批迁入镜像归档表后从原表删除（非物理丢弃，
 * 归档可导出/可彻底删除，见 server/services/logArchive.ts 与迁移 026）
 * POST /api/admin/logs/clean  { table: 'api_call_log', days: 90 }
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = cleanSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { table, days } = parsed.data

  // 表名白名单复用归档服务的硬编码映射（防注入）
  if (!ARCHIVABLE_TABLES[table]) {
    return validateError('不支持的表名，可选：api_call_log / cloud_service_call_log / admin_operation_log', 400)
  }

  // 分批迁入归档表（每批事务内 INSERT IGNORE + DELETE，避免长事务锁表）
  let archivedRows: number
  try {
    archivedRows = await archiveLogs(table, days)
  } catch (err) {
    logger.error('[admin logs clean] 归档失败:', err)
    return validateError('归档失败，请稍后重试', 500)
  }

  // 审计留痕（行为已从物理删除改为归档，action 同步改名）
  await logAdminOperation(user.id, 'logs.archive', table, 0, {
    table,
    days,
    archivedRows,
  })

  return validateSuccess({ archivedRows }, `已归档 ${archivedRows} 条记录`)
})
