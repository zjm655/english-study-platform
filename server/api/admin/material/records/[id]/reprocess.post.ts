import { readValidatedBody } from 'h3'
import { query } from '#server/utils/db'
import { adminMaterialRecordReprocessSchema, validateError, validateSuccess } from '#server/utils/validate'
import { processAdminMaterial } from '#server/utils/adminUpload'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 管理员重处理失败的上传记录
 * POST /api/admin/material/records/:id/reprocess
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const body = await readValidatedBody(event, adminMaterialRecordReprocessSchema.safeParse)
  if (!body.success) {
    return validateError(body.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { unitId } = body.data

  // 查询记录，仅 failed 可重处理
  const rows = await query<{
    user_id: number
    title: string
    text_content: string
    voice: string
    is_public: number
    status: string
  }>('SELECT user_id, title, text_content, voice, is_public, status FROM material_upload_record WHERE id = ?', [id])
  if (!rows.length) return validateError('记录不存在', 404)

  const record = rows[0]!
  if (record.status !== 'failed') {
    return validateError('仅失败记录可重处理', 400)
  }

  const config = useRuntimeConfig()

  // 调用 processAdminMaterial，传入 existingRecordId 复用记录
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