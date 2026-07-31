import { query } from '#server/utils/db'
import { adminUserListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminUserListItem, AdminUserListResult } from '#shared/types/adminUser'

/**
 * 管理员用户列表（服务端分页 + 账号/昵称搜索 + 状态筛选）
 * GET /api/admin/user
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_USERS)
  if (err) return err

  const parsed = adminUserListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, keyword, state } = parsed.data
  const offset = (page - 1) * pageSize

  // state 映射 WHERE：all=未销号正式用户；normal=未销号且正常；banned=未销号且封禁；deleted=已销号；guest=游客
  const where: string[] = []
  if (state === 'guest') {
    where.push('is_guest = 1')
    where.push('merged_into_user_id IS NULL') // 已合并的游客不显示
  } else {
    where.push('is_guest = 0')
    if (state === 'deleted') {
      where.push('deleted_at IS NOT NULL')
    } else {
      where.push('deleted_at IS NULL')
      if (state === 'normal') where.push('status = 1')
      else if (state === 'banned') where.push('status = 0')
    }
  }

  const params: (number | string)[] = []
  if (keyword) {
    where.push('(account LIKE ? OR nickname LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  const whereSql = where.join(' AND ')

  // 只 SELECT 必要字段，严禁 SELECT *（避免泄露 passwordHash）
  const list = await query<AdminUserListItem>(
    `SELECT id, account, nickname, email, role, level, status,
            is_guest AS isGuest, deleted_at AS deletedAt, createdAt
     FROM user
     WHERE ${whereSql}
     ORDER BY createdAt DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM user WHERE ${whereSql}`,
    params,
  )
  const total = Number(countRows[0]?.total ?? 0)

  const result: AdminUserListResult = { list, total, page, pageSize }
  return validateSuccess(result, '获取用户列表成功')
})
