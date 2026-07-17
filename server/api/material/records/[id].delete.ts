import { query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'

/**
 * 删除材料上传记录及关联的 segment（级联清理学习数据）
 * DELETE /api/material/records/:id
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  // 1. 校验记录归属并获取 segment_id
  const rows = await query<{ segment_id: number | null }>(
    'SELECT segment_id FROM material_upload_record WHERE id = ? AND user_id = ?',
    [id, user.id]
  )
  if (!rows.length) return validateError('记录不存在或无权限', 404)

  const segmentId = rows[0]?.segment_id ?? null

  // 2. 事务：先删 segment（级联清理 vocab/progress/recording/fav），再删 record
  try {
    await withTransaction(async (conn) => {
      if (segmentId) {
        await conn.execute('DELETE FROM segment WHERE id = ?', [segmentId])
      }
      await conn.execute('DELETE FROM material_upload_record WHERE id = ?', [id])
    })
  } catch (err) {
    console.error('[material record] 删除失败:', err)
    return validateError('删除失败，请稍后重试', 500)
  }

  return validateSuccess(null, '删除成功')
})
