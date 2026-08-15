import { query, withTransaction } from '#server/utils/db'
import { readBody } from 'h3'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'
import { analyzeFailSchema } from '#shared/schemas/recording'
import type { RecordingRow } from '#server/types/db'
import type { RowDataPacket } from 'mysql2'
import type { Recording } from '#shared/types/recording'

/**
 * 标记录音分析失败
 * 请求：POST /api/recording/[id]/analyze-fail
 * body（可选，P2-A）：{ errorCode?, errorMessage? }——SDK 结构化失败原因，写入 recording.analyze_error
 */
export default defineEventHandler(async (event): Promise<ResPayload<Recording | null>> => {
  // 身份解析：登录用户走 event.context.user，游客优先 guest_token 再指纹兜底
  const loggedInUserId = event.context.user?.id
  const fingerprint = !loggedInUserId ? getRequestHeader(event, 'x-guest-fingerprint') : null
  if (!loggedInUserId && !fingerprint) return validateError('未登录', 401)
  if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) return validateError('指纹格式无效')

  const id = Number(getRouterParam(event, 'id'))

  if (!id || isNaN(id)) {
    return validateError('无效的录音ID')
  }

  // 1. 查录音记录，验证归属
  const recordings = await query<RecordingRow>(
    'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  const recording = recordings[0]

  if (!recording) {
    return validateError('录音不存在', 404)
  }

  // 归属校验：登录用户直接比对；游客优先 guest_token 解析，指纹兜底
  let userId: number
  if (loggedInUserId) {
    userId = loggedInUserId
  } else {
    const resolved = await resolveEffectiveUserId(event)
    if (resolved) {
      userId = resolved
    } else {
      const userRows = await query<{ id: number }>(
        'SELECT id FROM user WHERE fingerprint_hash = ? AND is_guest = 1 AND merged_into_user_id IS NULL LIMIT 1',
        [fingerprint],
      )
      if (userRows.length === 0) return validateError('游客身份无效', 401)
      userId = userRows[0]!.id
    }
  }

  if (recording.user_id !== userId) {
    return validateError('无权限访问该录音', 403)
  }

  // 失败原因（可选 body）：无 body/校验失败按无错误处理（兼容旧调用，不阻断标记失败主流程）
  const rawBody = (await readBody(event).catch(() => ({}))) as Record<string, unknown>
  const parsed = analyzeFailSchema.safeParse(rawBody)
  const errorMessage = parsed.success ? (parsed.data.errorMessage ?? null) : null

  logger.info(`[recording analyze-fail] 标记分析失败 id=${id}`)

  // 2. 更新 analyze_status='failed'（analyze_error 用 COALESCE 保留旧值），并查回签名后的记录
  let updatedRecording: ReturnType<typeof rowToRecording>
  try {
    updatedRecording = await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE recording SET analyze_status = 'failed', analyze_error = COALESCE(?, analyze_error)
         WHERE id = ? AND user_id = ?`,
        [errorMessage, id, userId],
      )

      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT r.*, m.object_key AS rec_media_key
         FROM recording r
         LEFT JOIN media m ON r.media_id = m.id
         WHERE r.id = ? AND r.deleted_at IS NULL`,
        [id],
      )
      const row = rows[0] as (RecordingRow & { rec_media_key: string | null }) | undefined

      const signedPath = row?.rec_media_key
        ? await signUrl(row.rec_media_key, RECORDING_EXPIRE)
        : null
      return rowToRecording(row, signedPath)
    })
  } catch (err) {
    logger.error('[recording analyze-fail] 事务失败:', err)
    return validateError('标记失败，请稍后重试', 500)
  }

  if (!updatedRecording) {
    return validateError('标记失败', 500)
  }

  logger.info(`[recording analyze-fail] 已标记为分析失败 id=${id}`)
  return validateSuccess(updatedRecording, '已标记为分析失败')
})
