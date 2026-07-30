import { validateError, validateSuccess, recordStatusQuerySchema } from '#server/utils/validate'
import { fetchRecordStatuses } from '#server/services/materialRecordStatus'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { MaterialRecordStatusItem } from '#shared/types/material'

/**
 * 批量查询上传任务状态（管理端轮询轻接口，可查所有用户的记录）
 * GET /api/admin/material/records/status?ids=1,2,3
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<MaterialRecordStatusItem[] | null>> => {
    // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
    const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
    if (err) return err

    const parsed = recordStatusQuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
      return validateError(parsed.error.issues[0]?.message || '参数校验失败')
    }

    const items = await fetchRecordStatuses(parsed.data.ids)
    return validateSuccess(items)
  },
)
