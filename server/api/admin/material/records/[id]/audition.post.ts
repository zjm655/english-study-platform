import { query } from '#server/utils/db'
import { validateError } from '#server/utils/validate'
import { ensurePermission, auditionUnlock } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 审核门禁——上传记录试听解锁
 * POST /api/admin/material/records/:id/audition   body: { reasonCategory, reason }
 *
 * 流程：REVIEW 权限 → 联表取 object_key + 归属 user_id → 同步留痕成功后才签名返回。
 * 留痕失败即拒签（500），绝不产生「已放行但审计丢失」。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.REVIEW)
  if (err) return err

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const rows = await query<{
    user_id: number | null
    media_key: string | null
    media_duration: string | number | null
  }>(
    `SELECT r.user_id, m.object_key AS media_key, m.duration AS media_duration
     FROM material_upload_record r
     LEFT JOIN segment s ON r.segment_id = s.id
     LEFT JOIN media m ON s.media_id = m.id
     WHERE r.id = ?`,
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)
  const row = rows[0]!

  try {
    return await auditionUnlock(event, {
      targetType: 'material_record',
      targetId: id,
      mediaKey: row.media_key,
      targetUserId: row.user_id,
      duration: row.media_duration != null ? Number(row.media_duration) : null,
    })
  } catch (e) {
    logger.error('[audition] 上传记录留痕失败，拒绝签名:', e)
    return validateError('留痕失败，暂时无法试听，请重试', 500)
  }
})
