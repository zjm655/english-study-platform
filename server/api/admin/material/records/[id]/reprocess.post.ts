import { readBody } from 'h3'
import type { ResultSetHeader } from 'mysql2'
import { query } from '#server/utils/db'
import {
  adminMaterialRecordReprocessSchema,
  validateError,
  validateSuccess,
} from '#server/utils/validate'
import { processAdminMaterial } from '#server/utils/adminUpload'
import { updateRecordFailed } from '#server/utils/materialJob'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理员重处理失败的上传记录
 * POST /api/admin/material/records/:id/reprocess
 *
 * 防重入：先将 status 从 failed 原子更新为 queued，利用状态机避免并发重复触发；
 * 排队期间保持 queued（正确计入队列深度/排队位置口径），由 processAdminMaterial 执行时置 processing。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const body = await readBody(event)
  const parsed = adminMaterialRecordReprocessSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { unitId } = parsed.data

  // 原子状态转换：failed → queued（防重入，affectedRows=0 说明已被抢占或状态不对）
  const lockResult = await query<ResultSetHeader>(
    'UPDATE material_upload_record SET status = ?, error_message = NULL WHERE id = ? AND status = ?',
    ['queued', id, 'failed'],
  )
  const affected = (lockResult as unknown as ResultSetHeader).affectedRows ?? 0
  if (affected === 0) {
    // 可能记录不存在，也可能已不是 failed 状态
    const rows = await query<{ status: string }>(
      'SELECT status FROM material_upload_record WHERE id = ?',
      [id],
    )
    if (!rows.length) return validateError('记录不存在', 404)
    return validateError('仅失败记录可重处理，当前状态：' + rows[0]!.status, 400)
  }

  // 获取记录完整信息
  const rows = await query<{
    user_id: number
    title: string
    text_content: string
    voice: string
    is_public: number
  }>(
    'SELECT user_id, title, text_content, voice, is_public FROM material_upload_record WHERE id = ?',
    [id],
  )
  const record = rows[0]!
  const config = useRuntimeConfig()

  // fire-and-forget：入 upload 队列异步处理（管理员低优先级），失败时 processAdminMaterial 内部会将 status 改回 failed
  const { withQueue } = await import('#server/utils/serviceQueue')
  withQueue(
    'upload',
    () =>
      processAdminMaterial({
        userId: record.user_id,
        unitId,
        textContent: record.text_content,
        title: record.title,
        voice: record.voice,
        isPublic: record.is_public,
        bucket: config.oss.bucket || '',
        existingRecordId: id,
      }),
    { priority: 0 },
  ).catch(async (err) => {
    // 兜底：任务在排队阶段被拒时回写 failed，避免记录永久卡在 queued/processing
    logger.error('[admin reprocess] 重处理异常:', err)
    await updateRecordFailed(id, '任务调度异常，请重试').catch(() => {})
  })

  return validateSuccess(null, '重处理已提交')
})
