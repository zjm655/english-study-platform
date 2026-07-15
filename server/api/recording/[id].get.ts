import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { Recording } from '#shared/types/recording'

/**
 * 获取单条录音详情
 * 请求：GET /api/recording/:id
 */
export default defineEventHandler(async (event): Promise<ResPayload<Recording | null>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)
  const id = Number(getRouterParam(event, 'id'))

  if (!id || isNaN(id)) {
    return validateError('无效的录音ID')
  }

  const rows = await query<RecordingRow>(
    'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
    [id]
  )
  const recording = rows[0]

  if (!recording) {
    return validateError('录音不存在', 404)
  }

  // 归属权校验：只能查看自己的录音
  if (recording.user_id !== userId) {
    return validateError('无权限访问该录音', 403)
  }

  return validateSuccess(rowToRecording(recording), '获取成功')
})
