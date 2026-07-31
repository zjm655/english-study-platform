import { query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import { processEvaluationResult } from '#server/utils/evaluationResult'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'
import type { RecordingRow } from '#server/types/db'
import type { RowDataPacket } from 'mysql2'
import type { Recording } from '#shared/types/recording'

/**
 * 保存录音 AI 分析结果
 * 请求：POST /api/recording/[id]/analyze
 * Body: { result: { score, wordScores, rawResult? } }
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
    // 优先通过 guest_token 解析（与录音上传同一身份通道）
    const resolved = await resolveEffectiveUserId(event)
    if (resolved) {
      userId = resolved
    } else {
      // 指纹兜底
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

  // 2. 读取前端传来的评测结果
  const body = await readBody<{
    result?: {
      score: number
      wordScores: { word: string; score: number }[]
      rawResult?: string
    }
  }>(event)
  const evalResult = body?.result

  if (!evalResult || typeof evalResult.score !== 'number') {
    return validateError('缺少有效的评测结果数据', 400)
  }

  logger.info(`[recording analyze] 保存分析结果 id=${id} score=${evalResult.score}`)

  // 3. 处理评测结果（补全 status + 生成 feedback）
  const parsed = processEvaluationResult(evalResult)

  // 4. 更新 recording 表
  let updatedRecording: ReturnType<typeof rowToRecording>
  try {
    updatedRecording = await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE recording
         SET score = ?, feedback = ?, wordScores = ?, rawResult = ?, analyze_status = 'success'
         WHERE id = ?`,
        [
          parsed.score,
          parsed.feedback,
          JSON.stringify(parsed.wordScores),
          evalResult.rawResult ?? null,
          id,
        ],
      )

      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
        [id],
      )
      return rowToRecording(rows[0] as RecordingRow)
    })
  } catch (err) {
    logger.error('[recording analyze] 事务失败:', err)
    return validateError('分析保存失败，请稍后重试', 500)
  }

  if (!updatedRecording) {
    return validateError('分析保存失败', 500)
  }

  logger.info(`[recording analyze] 分析完成 id=${id} score=${parsed.score}`)
  return validateSuccess(updatedRecording, '分析完成')
})
