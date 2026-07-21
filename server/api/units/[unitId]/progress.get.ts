import { query } from '#server/utils/db'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
import type { UnitRow, UserProgressRow } from '#server/types/db'
import type { UnitProgressDetail } from '#shared/types/unit'
import { mapProgressRow, DEFAULT_PROGRESS } from '#shared/utils/progress'

/** 生成签名 URL：使用 media 表的 object_key */
async function signFromMedia(
  objectKey: string | null,
  expires: number = MATERIAL_EXPIRE,
): Promise<string | null> {
  if (objectKey) return signUrl(objectKey, expires)
  return null
}

/**
 * 获取单元进度详情（含片段列表）
 * 请求：GET /api/units/[unitId]/progress
 */
export default defineEventHandler(async (event): Promise<ResPayload<UnitProgressDetail | null>> => {
  const userId: number = event.context.user.id
  const unitId = Number(getRouterParam(event, 'unitId'))

  if (isNaN(unitId)) {
    return validateError('无效的单元ID')
  }

  // 分页参数（默认第 1 页，每页 10 条，pageSize 上限 50）
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(q.pageSize) || 10))
  const offset = (page - 1) * pageSize
  const adminFlag = event.context.user.role === 1 ? 1 : 0

  // 1. 查单元信息（联查 media 表获取封面音频）
  const units = await query<UnitRow & { unit_media_key: string | null }>(
    `SELECT u.*, m.object_key AS unit_media_key
     FROM unit u
     LEFT JOIN media m ON u.cover_media_id = m.id
     WHERE u.id = ?`,
    [unitId],
  )
  const unit = units[0]
  if (!unit) {
    return validateError('单元不存在', 404)
  }

  // 2. 查片段列表（可见性过滤 + 自己的置顶 + 分页）
  //    可见性：管理员可见全部；普通用户只看公开(is_public=1)或自己上传的(media.uploader_id=userId)
  const visibilityWhere = `s.unit_id = ? AND s.deleted_at IS NULL AND (? = 1 OR s.is_public = 1 OR m.uploader_id = ?)`
  const segments = await query<
    { id: number; title: string; sortOrder: number; isMine: number } & {
      seg_media_key: string | null
    }
  >(
    `SELECT s.id, s.title, s.sort_order AS sortOrder,
            m.object_key AS seg_media_key,
            (m.uploader_id = ?) AS isMine
     FROM segment s
     LEFT JOIN media m ON s.media_id = m.id
     WHERE ${visibilityWhere}
     ORDER BY isMine DESC, s.sort_order
     LIMIT ? OFFSET ?`,
    [userId, unitId, adminFlag, userId, pageSize, offset],
  )

  // 2b. 总数（与主查询共享 WHERE，用于 hasMore）
  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM segment s
     LEFT JOIN media m ON s.media_id = m.id
     WHERE ${visibilityWhere}`,
    [unitId, adminFlag, userId],
  )
  const total = Number(countRows[0]?.total ?? 0)

  // 3. 查进度
  const progressRows = await query<UserProgressRow>(
    'SELECT * FROM user_progress WHERE user_id = ? AND segment_id IN (SELECT id FROM segment WHERE unit_id = ? AND deleted_at IS NULL)',
    [userId, unitId],
  )
  const progressMap = new Map(progressRows.map((r) => [r.segment_id, r]))

  // 4. 签名片段音频
  const segmentsWithProgress = await Promise.all(
    segments.map(async (s) => ({
      id: s.id,
      title: s.title,
      audioUrl: await signFromMedia(s.seg_media_key, MATERIAL_EXPIRE),
      sortOrder: s.sortOrder,
      isMine: s.isMine === 1,
      progress: (() => {
        const p = progressMap.get(s.id)
        return p ? mapProgressRow(p) : { ...DEFAULT_PROGRESS }
      })(),
    })),
  )

  // 5. 组合返回
  const result: UnitProgressDetail = {
    unit: {
      id: unit.id,
      title: unit.title,
      description: unit.description,
      level: unit.level,
      sortOrder: unit.sort_order,
      audioUrl: await signFromMedia(unit.unit_media_key, MATERIAL_EXPIRE),
    },
    segments: segmentsWithProgress,
    pagination: { page, pageSize, total, hasMore: offset + pageSize < total },
  }

  return validateSuccess(result, '获取成功')
})
