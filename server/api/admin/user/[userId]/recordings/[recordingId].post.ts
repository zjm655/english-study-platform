import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { getClientIp } from '#server/utils/clientIp'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission, writeReviewAccessLog } from '#server/services/permission'
import { PERMISSIONS, REVIEW_REASON_CATEGORIES } from '#shared/utils/permission'
import type { ReviewReasonCategory } from '#shared/utils/permission'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { AdminRecordingDetailResult } from '#shared/types/adminUser'

/**
 * 审核门禁——查看某用户录音的评测详情（配音 / 影子跟读）
 * POST /api/admin/user/:userId/recordings/:recordingId   body: { reasonCategory, reason }
 *
 * 流程：REVIEW 权限 → 归属校验取 object_key + 原文 → 校验理由 → 同步留痕成功后才签名返回。
 * 留痕失败即拒签（500），绝不产生「已放行但审计丢失」。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.REVIEW)
  if (err) return err

  const userId = Number(getRouterParam(event, 'userId'))
  const recordingId = Number(getRouterParam(event, 'recordingId'))
  if (!userId || isNaN(userId)) return validateError('无效的用户ID')
  if (!recordingId || isNaN(recordingId)) return validateError('无效的录音ID')

  // 归属校验：限定 user_id，避免跨用户越权（不存在或不属于该用户 → 404）
  const rows = await query<
    RecordingRow & { rec_media_key: string | null; segmentTitle: string; referenceText: string }
  >(
    `SELECT r.*, m.object_key AS rec_media_key,
            s.title AS segmentTitle, s.textContent AS referenceText
     FROM recording r
     LEFT JOIN media m ON r.media_id = m.id
     JOIN segment s ON r.segment_id = s.id
     WHERE r.id = ? AND r.user_id = ? AND r.deleted_at IS NULL`,
    [recordingId, userId],
  )
  if (!rows.length) return validateError('录音不存在或不属于该用户', 404)
  const row = rows[0]!

  // 校验理由（就地内联：白名单类别 + reason 1-500）
  const body = await readBody(event)
  const reasonCategory = typeof body?.reasonCategory === 'string' ? body.reasonCategory.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!REVIEW_REASON_CATEGORIES.includes(reasonCategory as ReviewReasonCategory)) {
    return validateError('请选择合法的查看理由类别', 400)
  }
  if (!reason || reason.length > 500) {
    return validateError('请填写查看理由（1-500 字）', 400)
  }

  const user = event.context.user as { id?: number; role?: number } | undefined

  // 先留痕后签名：写失败即拒签（500），绝不产生「已放行但审计丢失」
  try {
    await writeReviewAccessLog({
      operatorId: user?.id ?? null,
      operatorRole: user?.role ?? 0,
      targetType: 'recording',
      targetId: recordingId,
      targetUserId: userId,
      reasonCategory,
      reason,
      ip: getClientIp(event) === 'unknown' ? null : getClientIp(event),
    })
  } catch (e) {
    logger.error('[recording-review] 留痕失败，拒绝签名:', e)
    return validateError('留痕失败，暂时无法查看，请重试', 500)
  }

  // 仅当留痕成功才签名录音音频
  const signedPath = row.rec_media_key ? await signUrl(row.rec_media_key, RECORDING_EXPIRE) : null
  const recording = rowToRecording(row, signedPath)!
  const result: AdminRecordingDetailResult = {
    recording,
    segmentTitle: row.segmentTitle,
    referenceText: row.referenceText,
  }
  return validateSuccess(result, '已记录本次访问')
})
