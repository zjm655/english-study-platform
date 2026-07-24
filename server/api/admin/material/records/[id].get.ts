import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
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

  const rows = await query<
    AdminMaterialRecordDetail & {
      role: number | null
      media_key: string | null
      media_duration: string | null
    }
  >(
    `SELECT r.id, r.user_id, r.title, r.text_content, r.voice,
            r.is_public, r.status, r.error_message, r.segment_id,
            r.createdAt, r.updatedAt,
            COALESCE(u.account, '已注销用户') AS username,
            u.role,
            m.object_key AS media_key, m.duration AS media_duration
     FROM material_upload_record r
     LEFT JOIN user u ON r.user_id = u.id
     LEFT JOIN segment s ON r.segment_id = s.id
     LEFT JOIN media m ON s.media_id = m.id
     WHERE r.id = ?`,
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)

  const row = rows[0]!
  // 授权口径：普通管理员仅可试听「管理员上传」或「公开」材料；
  // 非公开用户材料后端硬门禁返回 null，绝不签名（需审核权限，见后续设计）。
  const canAudition = row.role === ROLE_ADMIN || row.is_public === 1
  const audioUrl =
    canAudition && row.media_key ? await signUrl(row.media_key, MATERIAL_EXPIRE) : null
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
    audioUrl,
    duration: row.media_duration ? Number(row.media_duration) : null,
  }

  return validateSuccess(detail, '获取详情成功')
})
