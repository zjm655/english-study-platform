import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminSegmentBatchSchema } from '#shared/schemas/batch'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { BatchResult, BatchSkippedItem } from '#shared/types/adminBatch'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员批量操作材料（部分成功语义，HTTP 恒 200，结果见 BatchResult）
 * POST /api/admin/segment/batch
 *
 * - delete：批量软删除（置 deleted_at）
 * - move：批量修改所属单元（unitId=0 为系统保留的自定义单元，合法目标）
 * 不存在/已删除的材料进 skipped；审计每批一条（xxx.batchYyy，detail 含 ids 与成败明细）。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = adminSegmentBatchSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { action, ids } = parsed.data

  // move 前置校验：目标单元须存在且未删除（0=自定义单元保留位，无需查表）
  if (parsed.data.action === 'move' && parsed.data.unitId !== 0) {
    const unitRows = await query<{ id: number }>(
      'SELECT id FROM unit WHERE id = ? AND deleted_at IS NULL',
      [parsed.data.unitId],
    )
    if (unitRows.length === 0) {
      return validateError('目标单元不存在或已删除', 404)
    }
  }

  // 预查存在集（未删材料），差集进 skipped
  const placeholders = ids.map(() => '?').join(', ')
  const existRows = await query<{ id: number }>(
    `SELECT id FROM segment WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids,
  )
  const existIds = existRows.map((r) => r.id)
  const existSet = new Set(existIds)
  const skipped: BatchSkippedItem[] = ids
    .filter((id) => !existSet.has(id))
    .map((id) => ({ id, reason: '材料不存在或已删除' }))

  let succeeded = 0
  if (existIds.length > 0) {
    const existPlaceholders = existIds.map(() => '?').join(', ')
    if (action === 'delete') {
      const result = await query<ResultSetHeader>(
        `UPDATE segment SET deleted_at = NOW() WHERE id IN (${existPlaceholders}) AND deleted_at IS NULL`,
        existIds,
      )
      succeeded = (result as unknown as ResultSetHeader).affectedRows ?? 0
    } else {
      const result = await query<ResultSetHeader>(
        `UPDATE segment SET unit_id = ? WHERE id IN (${existPlaceholders}) AND deleted_at IS NULL`,
        [parsed.data.unitId, ...existIds],
      )
      succeeded = (result as unknown as ResultSetHeader).affectedRows ?? 0
    }
  }

  const logAction = action === 'delete' ? 'segment.batchDelete' : 'segment.batchMove'
  await logAdminOperation(user.id, logAction, 'segment', 0, {
    ids,
    ...(parsed.data.action === 'move' ? { unitId: parsed.data.unitId } : {}),
    succeeded,
    skipped,
  })

  const data: BatchResult = { succeeded, skipped }
  return validateSuccess(data, `成功 ${succeeded} 条，跳过 ${skipped.length} 条`)
})
