import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 采用说话人标注：把 material_upload_record.speaker_annotated 回写 text_content
 * POST /api/admin/material/records/:id/speaker-annotate（权限 MANAGE_MATERIALS）
 * 不自动重处理，由管理员另行触发重处理。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const rows = await query<{ speaker_annotated: string | null; title: string }>(
    `SELECT speaker_annotated, title FROM material_upload_record WHERE id = ?`,
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)
  const annotated = rows[0]!.speaker_annotated
  if (!annotated || !annotated.trim()) {
    return validateError('该记录暂无说话人标注，无法采用', 400)
  }

  await query(`UPDATE material_upload_record SET text_content = ? WHERE id = ?`, [
    annotated,
    id,
  ])

  await logAdminOperation(user.id, 'material.speaker_annotate', 'material_upload_record', id, {
    title: rows[0]!.title,
  })

  return validateSuccess(null, '已采用说话人标注作为正文（未自动重处理）')
})