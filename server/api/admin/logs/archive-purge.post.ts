import { readBody } from 'h3'
import { validateError, validateSuccess } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { purgeArchive, ARCHIVABLE_TABLES } from '#server/services/logArchive'
import { PERMISSIONS } from '#shared/utils/permission'
import { z } from 'zod'

const purgeSchema = z.object({
  table: z.string(),
  // 彻底删除不可恢复，强制最少保留 30 天归档
  days: z.coerce.number().min(30, '归档至少保留 30 天').max(3650, '最多删除 3650 天前归档'),
})

/**
 * 管理员彻底删除归档表中超期数据（物理删除，不可恢复；按原始日志时间 createdAt 过滤）
 * POST /api/admin/logs/archive-purge  { table: 'api_call_log', days: 180 }
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_LOGS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = purgeSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { table, days } = parsed.data

  if (!ARCHIVABLE_TABLES[table]) {
    return validateError('不支持的表名，可选：api_call_log / cloud_service_call_log / admin_operation_log', 400)
  }

  let deletedRows: number
  try {
    deletedRows = await purgeArchive(table, days)
  } catch (err) {
    logger.error('[admin logs archive-purge] 归档彻底删除失败:', err)
    return validateError('删除失败，请稍后重试', 500)
  }

  // 审计留痕：物理删除必须可追溯
  await logAdminOperation(user.id, 'logs.purge', table, 0, {
    table,
    days,
    deletedRows,
  })

  return validateSuccess({ deletedRows }, `已彻底删除 ${deletedRows} 条归档`)
})
