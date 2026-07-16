import { query } from '#server/utils/db'
import { signAudioUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { Recording } from '#shared/types/recording'

/**
 * 获取当前用户某片段的录音列表
 * 请求：GET /api/recording?segmentId=1&phase=3
 */
export default defineEventHandler(async (event): Promise<ResPayload<Recording[] | null>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  const q = getQuery(event)
  const segmentId = Number(q.segmentId)
  const phase = q.phase !== undefined ? Number(q.phase) : undefined

  if (!segmentId || isNaN(segmentId)) {
    return validateError('无效的片段ID')
  }

  // 动态构建 SQL，始终绑定 user_id 防越权
  let sql = 'SELECT * FROM recording WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL'
  const params: (number | string)[] = [userId, segmentId]

  if (phase !== undefined && !isNaN(phase)) {
    sql += ' AND phase = ?'
    params.push(phase)
  }
  sql += ' ORDER BY createdAt DESC'

  const rows = await query<RecordingRow>(sql, params)
  const recordings = rows.map(rowToRecording).filter((r): r is Recording => r !== null)

  // 为每条录音的 audioPath 生成签名链接
  const signedRecordings = await Promise.all(
    recordings.map(async (r) => ({
      ...r,
      audioPath: await signAudioUrl(r.audioPath, RECORDING_EXPIRE),
    }))
  )

  return validateSuccess(signedRecordings, '获取列表成功')
})