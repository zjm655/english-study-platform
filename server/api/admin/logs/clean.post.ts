import { readBody } from 'h3'
import type { ResultSetHeader } from 'mysql2'
import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'
import { z } from 'zod'

/** 表名白名单（防注入） */
const TABLE_WHITELIST: Record<string, string> = {
  api_call_log: 'api_call_log',
  cloud_service_call_log: 'cloud_service_call_log',
  admin_operation_log: 'admin_operation_log',
}

const cleanSchema = z.object({
  table: z.string(),
  days: z.coerce.number().min(7, '至少保留 7 天数据').max(365, '最多清理 365 天前数据'),
})

/**
 * 管理员按时间范围清理日志（分批删除，避免长事务锁表）
 * POST /api/admin/logs/clean  { table: 'api_call_log', days: 90 }
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const body = await readBody(event)
  const parsed = cleanSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { table, days } = parsed.data

  const safeTable = TABLE_WHITELIST[table]
  if (!safeTable) {
    return validateError('不支持的表名，可选：api_call_log / cloud_service_call_log / admin_operation_log', 400)
  }

  // 分批删除：每批 10000 行，避免长事务
  let totalDeleted = 0
  const BATCH_SIZE = 10000
  let affected = BATCH_SIZE

  try {
    while (affected === BATCH_SIZE) {
      const result = await query<ResultSetHeader>(
        `DELETE FROM ${safeTable} WHERE createdAt < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ${BATCH_SIZE}`,
        [days],
      )
      affected = Number((result as unknown as ResultSetHeader).affectedRows ?? 0)
      totalDeleted += affected
      // 批次间隔，降低锁竞争
      if (affected === BATCH_SIZE) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
  } catch (err) {
    logger.error('[admin logs clean] 清理失败:', err)
    return validateError('清理失败，请稍后重试', 500)
  }

  // 审计留痕
  await logAdminOperation(user.id, 'logs.clean', safeTable, 0, {
    table: safeTable,
    days,
    deletedRows: totalDeleted,
  })

  return validateSuccess({ deletedRows: totalDeleted }, `已清理 ${totalDeleted} 条记录`)
})
