import { readBody } from 'h3'
import {
  adminMaterialRecordReprocessSchema,
  validateError,
  validateSuccess,
} from '#server/utils/validate'
import { isUploadQueueFull } from '#server/utils/materialJob'
import { reprocessRecord } from '#server/utils/materialReprocess'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理员重处理失败的上传记录
 * POST /api/admin/material/records/:id/reprocess
 *
 * 核心逻辑（原子锁 failed→queued + 入队 + 兜底回写）在 reprocessRecord（materialReprocess.ts），
 * 与批量端点共用；本 handler 只做参数校验与入队前的队列深度防御。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const body = await readBody(event)
  const parsed = adminMaterialRecordReprocessSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { unitId } = parsed.data

  // 入队深度防御：与上传入口同口径（upload_queue_max 配置），防止重处理绕过限制堆积任务
  if (await isUploadQueueFull()) {
    return validateError('处理队列已满，请稍后再试', 400)
  }

  const result = await reprocessRecord(id, unitId)
  if (!result.ok) {
    return validateError(result.reason ?? '重处理失败', result.code ?? 400)
  }

  return validateSuccess(null, '重处理已提交')
})
