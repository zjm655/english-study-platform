import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUnitBatchSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { BatchResult, BatchSkippedItem } from '#shared/types/adminBatch'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员批量删除单元（软删除，部分成功语义，HTTP 恒 200，结果见 BatchResult）
 * POST /api/admin/unit/batch
 *
 * id=0 系统保留单元进 skipped（前端 :selectable 双保险）；与单条端点一致，
 * 允许删除含材料的单元（前端确认弹窗强提示），删除前统计各单元材料数写入审计 detail。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = adminUnitBatchSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  // schema 只放行正整数，id=0 天然进不了 ids；此处防御性过滤保持语义显式
  const ids = parsed.data.ids.filter((id) => id !== 0)
  const skipped: BatchSkippedItem[] = parsed.data.ids
    .filter((id) => id === 0)
    .map((id) => ({ id, reason: '系统保留单元不可删除' }))
  if (ids.length === 0) {
    return validateSuccess({ succeeded: 0, skipped } as BatchResult, '无可删除的单元')
  }

  const placeholders = ids.map(() => '?').join(', ')

  // 预查存在集（未删单元），差集进 skipped
  const existRows = await query<{ id: number }>(
    `SELECT id FROM unit WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids,
  )
  const existIds = existRows.map((r) => r.id)
  const existSet = new Set(existIds)
  for (const id of ids) {
    if (!existSet.has(id)) skipped.push({ id, reason: '单元不存在或已删除' })
  }

  // 删除前统计各单元未删材料数，写入审计 detail（记录影响面）
  let segmentCounts: Record<number, number> = {}
  let succeeded = 0
  if (existIds.length > 0) {
    const existPlaceholders = existIds.map(() => '?').join(', ')
    const countRows = await query<{ unit_id: number; total: number }>(
      `SELECT unit_id, COUNT(*) AS total FROM segment
       WHERE unit_id IN (${existPlaceholders}) AND deleted_at IS NULL
       GROUP BY unit_id`,
      existIds,
    )
    segmentCounts = Object.fromEntries(countRows.map((r) => [r.unit_id, Number(r.total)]))

    const result = await query<ResultSetHeader>(
      `UPDATE unit SET deleted_at = NOW() WHERE id IN (${existPlaceholders}) AND deleted_at IS NULL`,
      existIds,
    )
    succeeded = (result as unknown as ResultSetHeader).affectedRows ?? 0
  }

  await logAdminOperation(user.id, 'unit.batchDelete', 'unit', 0, {
    ids: parsed.data.ids,
    segmentCounts,
    succeeded,
    skipped,
  })

  const data: BatchResult = { succeeded, skipped }
  return validateSuccess(data, `成功 ${succeeded} 条，跳过 ${skipped.length} 条`)
})
