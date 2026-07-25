import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUnitSaveSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员编辑单元（title/description/level/sort_order 四字段）
 * PUT /api/admin/unit/[unitId]
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
  // id=0 是「用户自定义材料」系统保留单元（所有用户上传材料的落点），禁止编辑
  if (unitId === 0) {
    return validateError('系统保留单元不可编辑', 403)
  }

  const body = await readBody(event)
  const parsed = adminUnitSaveSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { title, description, level, sortOrder } = parsed.data

  // 空简介归一为 null（与种子数据的存储约定一致）
  const finalDescription = description == null || description === '' ? null : description

  // mysql2 对 UPDATE 语句返回 ResultSetHeader（含 affectedRows），query() 泛型仅做类型标注
  const result = await query<ResultSetHeader>(
    `UPDATE unit SET title = ?, description = ?, level = ?, sort_order = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [title, finalDescription, level, sortOrder, unitId],
  )
  const affectedRows = (result as unknown as ResultSetHeader).affectedRows ?? 0
  if (affectedRows === 0) {
    return validateError('单元不存在或已删除', 404)
  }

  await logAdminOperation(user.id, 'unit.update', 'unit', unitId, { title, level, sortOrder })
  return validateSuccess(null, '保存成功')
})
