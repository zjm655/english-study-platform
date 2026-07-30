import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUnitSaveSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/services/adminLog'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员新建单元（普通自增 id；id=0 保留单元由 002 迁移种子固定，不经此端点）
 * POST /api/admin/unit
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = adminUnitSaveSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { title, description, level, sortOrder } = parsed.data

  // 空简介归一为 null（与种子数据的存储约定一致）
  const finalDescription = description == null || description === '' ? null : description

  const result = await query<ResultSetHeader>(
    'INSERT INTO unit (title, description, level, sort_order) VALUES (?, ?, ?, ?)',
    [title, finalDescription, level, sortOrder],
  )
  const unitId = (result as unknown as ResultSetHeader).insertId

  await logAdminOperation(user.id, 'unit.create', 'unit', unitId, { title, level })
  return validateSuccess({ id: unitId }, '新建成功')
})
