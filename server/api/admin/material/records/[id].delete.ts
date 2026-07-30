import { query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理员删除上传记录及关联 segment（软删除 + 事务 + 审计）
 * DELETE /api/admin/material/records/:id
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  // 查询记录确认存在并获取关联信息
  const rows = await query<{ segment_id: number | null; title: string | null; status: string }>(
    'SELECT segment_id, title, status FROM material_upload_record WHERE id = ?',
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)

  // 护栏：进行中的任务不可删除——流水线仍会写该记录/关联资源，删除会与其竞态产生孤儿数据
  const status = rows[0]!.status
  if (status === 'queued' || status === 'processing') {
    return validateError('任务进行中，无法删除', 400)
  }

  const segmentId = rows[0]?.segment_id ?? null
  const title = rows[0]?.title ?? ''

  // 事务：软删除 segment + 硬删除 record（record 无 deleted_at 字段）
  try {
    await withTransaction(async (conn) => {
      if (segmentId) {
        await conn.execute(
          'UPDATE segment SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
          [segmentId],
        )
      }
      await conn.execute('DELETE FROM material_upload_record WHERE id = ?', [id])
    })
  } catch (err) {
    logger.error('[admin material record] 删除失败:', err)
    return validateError('删除失败，请稍后重试', 500)
  }

  // 审计日志（静默吞错，不影响业务）
  await logAdminOperation(user.id, 'material-record.delete', 'material_upload_record', id, {
    title,
    segmentId,
  })

  return validateSuccess(null, '删除成功')
})
