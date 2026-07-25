import { query } from '#server/utils/db'
import { validateError } from '#server/utils/validate'
import { ensurePermission, auditionUnlock } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 审核门禁——材料（segment）试听解锁
 * POST /api/admin/segment/:segId/audition   body: { reasonCategory, reason }
 *
 * 流程：REVIEW 权限 → 联表取 object_key + 归属 user_id → 同步留痕成功后才签名返回。
 * 留痕失败即拒签（500），绝不产生「已放行但审计丢失」。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.REVIEW)
  if (err) return err

  const segId = Number(getRouterParam(event, 'segId'))
  if (!segId || isNaN(segId)) return validateError('无效的片段ID')

  const rows = await query<{
    media_key: string | null
    media_duration: string | number | null
    uploader_user_id: number | null
  }>(
    `SELECT m.object_key AS media_key, m.duration AS media_duration, r.user_id AS uploader_user_id
     FROM segment s
     LEFT JOIN media m ON s.media_id = m.id
     LEFT JOIN material_upload_record r ON r.segment_id = s.id
     WHERE s.id = ? AND s.deleted_at IS NULL`,
    [segId],
  )
  if (!rows.length) return validateError('材料不存在或已删除', 404)
  const row = rows[0]!

  try {
    return await auditionUnlock(event, {
      targetType: 'segment',
      targetId: segId,
      mediaKey: row.media_key,
      targetUserId: row.uploader_user_id,
      duration: row.media_duration != null ? Number(row.media_duration) : null,
    })
  } catch (e) {
    logger.error('[audition] 材料留痕失败，拒绝签名:', e)
    return validateError('留痕失败，暂时无法试听，请重试', 500)
  }
})
