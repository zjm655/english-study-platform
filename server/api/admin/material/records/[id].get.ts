import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import type { AdminMaterialRecordDetail } from '#shared/types/adminMaterialRecord'

/**
 * 管理员获取上传记录详情（含原文 text_content）
 * GET /api/admin/material/records/:id
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const rows = await query<AdminMaterialRecordDetail & { role: number | null }>(
    `SELECT r.id, r.user_id, r.title, r.text_content, r.voice,
            r.is_public, r.status, r.error_message, r.segment_id,
            r.createdAt, r.updatedAt,
            COALESCE(u.account, '已注销用户') AS username,
            u.role
     FROM material_upload_record r
     LEFT JOIN user u ON r.user_id = u.id
     WHERE r.id = ?`,
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)

  const row = rows[0]!
  const detail: AdminMaterialRecordDetail = {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    text_content: row.text_content,
    voice: row.voice,
    is_public: row.is_public,
    status: row.status as AdminMaterialRecordDetail['status'],
    error_message: row.error_message,
    segment_id: row.segment_id,
    username: row.username,
    source: row.role === ROLE_ADMIN ? 'admin' : 'user',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }

  return validateSuccess(detail, '获取详情成功')
})