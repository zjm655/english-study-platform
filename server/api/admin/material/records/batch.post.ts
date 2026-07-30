import { readBody } from 'h3'
import { query, withTransaction } from '#server/utils/db'
import {
  adminMaterialRecordBatchSchema,
  validateSuccess,
  validateError,
} from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { getUploadLimits } from '#server/utils/uploadLimitChecker'
import { reprocessRecord } from '#server/services/materialReprocess'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { BatchResult, BatchSkippedItem } from '#shared/types/adminBatch'

/**
 * 管理员批量操作上传记录（部分成功语义，HTTP 恒 200，结果见 BatchResult）
 * POST /api/admin/material/records/batch
 *
 * - delete：批量删除（单事务：软删关联 segment + 硬删 record）；queued/processing 进 skipped
 * - reprocess：批量重试（ids ≤20）；按 upload_queue_max 剩余容量截断，逐条走 failed→queued
 *   原子锁（需精确知道每个 id 抢锁成败，非 failed 自动进 skipped）
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = adminMaterialRecordBatchSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { action, ids } = parsed.data

  const skipped: BatchSkippedItem[] = []
  let succeeded = 0

  if (action === 'delete') {
    // 预查状态：进行中任务不可删除（与单条端点同款护栏，防与流水线写库竞态）
    const placeholders = ids.map(() => '?').join(', ')
    const rows = await query<{ id: number; status: string; segment_id: number | null }>(
      `SELECT id, status, segment_id FROM material_upload_record WHERE id IN (${placeholders})`,
      ids,
    )
    const rowMap = new Map(rows.map((r) => [r.id, r]))
    const deletableIds: number[] = []
    const segmentIds: number[] = []
    for (const id of ids) {
      const row = rowMap.get(id)
      if (!row) {
        skipped.push({ id, reason: '记录不存在' })
      } else if (row.status === 'queued' || row.status === 'processing') {
        skipped.push({ id, reason: '任务进行中，无法删除' })
      } else {
        deletableIds.push(id)
        if (row.segment_id) segmentIds.push(row.segment_id)
      }
    }

    if (deletableIds.length > 0) {
      try {
        await withTransaction(async (conn) => {
          if (segmentIds.length > 0) {
            const segPlaceholders = segmentIds.map(() => '?').join(', ')
            await conn.execute(
              `UPDATE segment SET deleted_at = NOW() WHERE id IN (${segPlaceholders}) AND deleted_at IS NULL`,
              segmentIds,
            )
          }
          const delPlaceholders = deletableIds.map(() => '?').join(', ')
          await conn.execute(
            `DELETE FROM material_upload_record WHERE id IN (${delPlaceholders})`,
            deletableIds,
          )
        })
        succeeded = deletableIds.length
      } catch (err) {
        logger.error('[admin material record] 批量删除失败:', err)
        return validateError('批量删除失败，请稍后重试', 500)
      }
    }

    await logAdminOperation(user.id, 'material-record.batchDelete', 'material_upload_record', 0, {
      ids,
      segmentIds,
      succeeded,
      skipped,
    })
  } else {
    // reprocess：按剩余容量截断（upload_queue_max 配置 - 当前 queued 数），超出进 skipped
    const { uploadQueueMax } = await getUploadLimits()
    const countRows = await query<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM material_upload_record WHERE status = 'queued'`,
    )
    const queuedCount = Number(countRows[0]?.cnt ?? 0)
    const remaining = Math.max(0, uploadQueueMax - queuedCount)
    const acceptedIds = ids.slice(0, remaining)
    for (const id of ids.slice(remaining)) {
      skipped.push({ id, reason: '处理队列已满，请稍后再试' })
    }

    // 逐条原子锁（N≤20 开销可忽略；IN 版 UPDATE 无法区分哪些行被更新）
    for (const id of acceptedIds) {
      const result = await reprocessRecord(id, parsed.data.unitId)
      if (result.ok) {
        succeeded++
      } else {
        skipped.push({ id, reason: result.reason ?? '重处理失败' })
      }
    }

    await logAdminOperation(
      user.id,
      'material-record.batchReprocess',
      'material_upload_record',
      0,
      { ids, unitId: parsed.data.unitId, succeeded, skipped },
    )
  }

  const data: BatchResult = { succeeded, skipped }
  return validateSuccess(data, `成功 ${succeeded} 条，跳过 ${skipped.length} 条`)
})
