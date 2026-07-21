import { readBody } from 'h3'
import { query } from '#server/utils/db'
import {
  adminMaterialRecordReprocessSchema,
  validateError,
  validateSuccess,
} from '#server/utils/validate'
import { processAdminMaterial } from '#server/utils/adminUpload'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 管理员重处理失败的上传记录
 * POST /api/admin/material/records/:id/reprocess
 *
 * 防重入：先将 status 从 failed 原子更新为 processing，利用状态机避免并发重复触发。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const body = await readBody(event)
  const parsed = adminMaterialRecordReprocessSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { unitId } = parsed.data

  // 原子状态转换：failed → processing（防重入，affectedRows=0 说明已被抢占或状态不对）
  const lockResult = await query<{ affectedRows: number }>(
    'UPDATE material_upload_record SET status = ? WHERE id = ? AND status = ?',
    ['processing', id, 'failed'],
  )
  const affected = Number((lockResult as any)?.affectedRows ?? (lockResult as any)?.info ?? 0)
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

  // fire-and-forget：异步处理，失败时 processAdminMaterial 内部会将 status 改回 failed
  processAdminMaterial({
    userId: record.user_id,
    unitId,
    textContent: record.text_content,
    title: record.title,
    voice: record.voice,
    isPublic: record.is_public,
    bucket: config.oss.bucket || '',
    existingRecordId: id,
  }).catch((err) => {
    logger.error('[admin reprocess] 重处理异常:', err)
  })

  return validateSuccess(null, '重处理已提交')
})
