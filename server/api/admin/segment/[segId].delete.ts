import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员软删除材料（置 deleted_at，不物理删除；用户侧查询据此过滤）
 * DELETE /api/admin/segment/[segId]
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const segId = Number(getRouterParam(event, 'segId'))
  if (!segId || isNaN(segId)) {
    return validateError('无效的片段ID')
  }

  // mysql2 对 UPDATE 语句返回 ResultSetHeader（含 affectedRows），query() 泛型仅做类型标注
  const result = await query<ResultSetHeader>(
    'UPDATE segment SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [segId]
  )
  const affectedRows = (result as unknown as ResultSetHeader).affectedRows ?? 0
  if (affectedRows === 0) {
    return validateError('材料不存在或已删除', 404)
  }

  await logAdminOperation(user.id, 'segment.delete', 'segment', segId)
  return validateSuccess(null, '删除成功')
})
