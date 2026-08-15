import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { getClientIp } from '#server/utils/clientIp'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission, writeReviewAccessLog } from '#server/services/permission'
import {
  PERMISSIONS,
  REVIEW_REASON_CATEGORIES,
  type ReviewReasonCategory,
} from '#shared/utils/permission'
import { isAdminOrAbove } from '#shared/utils/role'

/**
 * 审核门禁——材料公开状态调整
 * PUT /api/admin/segment/:segId/visibility   body: { isPublic: 0|1, reasonCategory, reason }
 *
 * 参照音频试听：REVIEW 权限 → 校验理由 → 确认为「受限材料」（非公开的用户材料）
 * → 同步留痕成功后才 UPDATE is_public。留痕失败即拒绝变更（500），
 * 绝不产生「已改状态但审计丢失」。仅有 MANAGE_MATERIALS 的管理员经批量保存无法绕过（见 [segId].put.ts）。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.REVIEW)
  if (err) return err
  const user = event.context.user

  const segId = Number(getRouterParam(event, 'segId'))
  if (!segId || isNaN(segId)) return validateError('无效的片段ID')

  const body = await readBody(event)
  const isPublic = Number(body?.isPublic)
  if (isPublic !== 0 && isPublic !== 1) return validateError('isPublic 必须为 0 或 1', 400)
  const reasonCategory = typeof body?.reasonCategory === 'string' ? body.reasonCategory.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!REVIEW_REASON_CATEGORIES.includes(reasonCategory as ReviewReasonCategory)) {
    return validateError('请选择合法的查看理由类别', 400)
  }
  if (!reason || reason.length > 500) {
    return validateError('请填写查看理由（1-500 字）', 400)
  }

  // 联表取上传者归属，确认为「受限材料」（非公开的用户材料）——否则无需走门禁。
  const rows = await query<{
    is_public: number
    uploader_user_id: number | null
    uploader_role: number | null
  }>(
    `SELECT s.is_public, r.user_id AS uploader_user_id, uu.role AS uploader_role
     FROM segment s
     LEFT JOIN material_upload_record r ON r.segment_id = s.id
     LEFT JOIN user uu ON r.user_id = uu.id
     WHERE s.id = ? AND s.deleted_at IS NULL`,
    [segId],
  )
  if (!rows.length) return validateError('材料不存在或已删除', 404)
  const row = rows[0]!
  const uploaderIsAdmin = row.uploader_user_id == null || isAdminOrAbove(row.uploader_role)
  const isRestricted = !uploaderIsAdmin && row.is_public === 0
  if (!isRestricted) {
    return validateError('该材料无需通过审核门禁调整公开状态', 400)
  }

  // 先留痕后变更：写失败即拒绝（与音频试听一致），绝不「已改状态但审计丢失」。
  try {
    await writeReviewAccessLog({
      operatorId: user.id,
      operatorRole: user.role,
      targetType: 'segment_visibility',
      targetId: segId,
      targetUserId: row.uploader_user_id,
      reasonCategory,
      reason,
      ip: getClientIp(event) === 'unknown' ? null : getClientIp(event),
    })
  } catch (e) {
    logger.error('[segment visibility] 留痕失败，拒绝调整:', e)
    return validateError('留痕失败，暂时无法调整，请重试', 500)
  }

  await query('UPDATE segment SET is_public = ? WHERE id = ? AND deleted_at IS NULL', [
    isPublic,
    segId,
  ])
  await logAdminOperation(user.id, 'segment.visibility.update', 'segment', segId, {
    isPublic,
    reasonCategory,
  })
  return validateSuccess({ isPublic }, '材料公开状态已更新')
})
