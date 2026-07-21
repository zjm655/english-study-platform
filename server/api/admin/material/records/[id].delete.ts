import { query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 管理员删除上传记录及关联 segment（事务）
 * DELETE /api/admin/material/records/:id
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  // 查询记录确认存在并获取 segment_id
  const rows = await query<{ segment_id: number | null }>(
    'SELECT segment_id FROM material_upload_record WHERE id = ?',
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)

  const segmentId = rows[0]?.segment_id ?? null

  // 事务：先删 segment（级联清理 vocab/progress/recording/fav），再删 record
  try {
    await withTransaction(async (conn) => {
      if (segmentId) {
        await conn.execute('DELETE FROM segment WHERE id = ?', [segmentId])
      }
      await conn.execute('DELETE FROM material_upload_record WHERE id = ?', [id])
    })
  } catch (err) {
    logger.error('[admin material record] 删除失败:', err)
    return validateError('删除失败，请稍后重试', 500)
  }

  return validateSuccess(null, '删除成功')
})