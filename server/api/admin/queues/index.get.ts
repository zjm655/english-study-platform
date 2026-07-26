import { getQueueStats } from '#server/utils/serviceQueue'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 查询各云服务并发队列实时水位
 * GET /api/admin/queues
 * 返回: [{ name, concurrency(0=不限流), size(排队中), pending(执行中) }]
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.CONFIG)
  if (err) return err

  return validateSuccess(getQueueStats(), '查询成功')
})
