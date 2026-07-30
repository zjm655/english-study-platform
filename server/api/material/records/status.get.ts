import { validateError, validateSuccess, recordStatusQuerySchema } from '#server/utils/validate'
import { fetchRecordStatuses } from '#server/services/materialRecordStatus'
import type { MaterialRecordStatusItem } from '#shared/types/material'

/**
 * 批量查询当前用户的上传任务状态（轮询轻接口）
 * GET /api/material/records/status?ids=1,2,3
 *
 * 仅返回属于当前用户的记录（防 IDOR 枚举他人 recordId）；ids 上限 50。
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<MaterialRecordStatusItem[] | null>> => {
    const user = event.context.user
    if (!user) return validateError('未登录', 401)

    const parsed = recordStatusQuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
      return validateError(parsed.error.issues[0]?.message || '参数校验失败')
    }

    const items = await fetchRecordStatuses(parsed.data.ids, user.id)
    return validateSuccess(items)
  },
)
