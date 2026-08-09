import { query, pool } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { updateMaterialRecordSchema } from '#shared/schemas/material'

/**
 * 更新材料上传记录（目前仅支持修改 is_public）
 * 同时同步更新关联 segment 的 is_public
 * PUT /api/material/records/:id
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const body = await readBody(event)
  const parsed = updateMaterialRecordSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message || '参数校验失败')
  }

  const { isPublic } = parsed.data

  // 1. 校验记录归属
  const rows = await query<{ segment_id: number | null }>(
    'SELECT segment_id FROM material_upload_record WHERE id = ? AND user_id = ?',
    [id, user.id],
  )
  if (!rows.length) return validateError('记录不存在或无权限', 404)

  const segmentId = rows[0]?.segment_id ?? null

  // 2. 更新记录
  await pool.execute('UPDATE material_upload_record SET is_public = ? WHERE id = ?', [isPublic, id])

  // 3. 同步更新关联 segment（如果有）
  if (segmentId) {
    await pool.execute('UPDATE segment SET is_public = ? WHERE id = ?', [isPublic, segmentId])
  }

  return validateSuccess(null, '更新成功')
})
