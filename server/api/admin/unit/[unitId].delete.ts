import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员软删除单元（置 deleted_at，不物理删除——segment.unit_id 外键为
 * ON DELETE CASCADE，物理删除会级联删光单元下材料；用户侧入口查询据此过滤）
 * DELETE /api/admin/unit/[unitId]
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  // 注意：unitId=0 是合法数字，不能用 !unitId 真值判断（会把 0 误判为无效）
  const unitId = Number(getRouterParam(event, 'unitId'))
  if (!Number.isInteger(unitId) || unitId < 0) {
    return validateError('无效的单元ID')
  }
  // id=0 是「用户自定义材料」系统保留单元（所有用户上传材料的落点），禁止删除
  if (unitId === 0) {
    return validateError('系统保留单元不可删除', 403)
  }

  // 删除前统计单元下未删材料数，写入审计 detail（记录影响面）
  const countRows = await query<{ total: number }>(
    'SELECT COUNT(*) AS total FROM segment WHERE unit_id = ? AND deleted_at IS NULL',
    [unitId],
  )
  const segmentCount = Number(countRows[0]?.total ?? 0)

  // mysql2 对 UPDATE 语句返回 ResultSetHeader（含 affectedRows），query() 泛型仅做类型标注
  const result = await query<ResultSetHeader>(
    'UPDATE unit SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [unitId],
  )
  const affectedRows = (result as unknown as ResultSetHeader).affectedRows ?? 0
  if (affectedRows === 0) {
    return validateError('单元不存在或已删除', 404)
  }

  await logAdminOperation(user.id, 'unit.delete', 'unit', unitId, { segmentCount })
  return validateSuccess(null, '删除成功')
})
