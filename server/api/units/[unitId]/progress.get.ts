import { query } from '#server/utils/db'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
import type { UnitRow, UserProgressRow } from '#server/types/db'
import type { UnitProgressDetail } from '#shared/types/unit'

/** 生成签名 URL：优先使用 media 表的 object_key，降级到旧字段 */
async function signFromMedia(
  objectKey: string | null,
  fallbackUrl: string | null,
  expires: number = MATERIAL_EXPIRE
): Promise<string | null> {
  if (objectKey) return signUrl(objectKey, expires)
  if (!fallbackUrl) return null
  if (!fallbackUrl.startsWith('https://')) return fallbackUrl
  return signUrl(fallbackUrl, expires)
}

/**
 * 获取单元进度详情（含片段列表）
 * 请求：GET /api/units/[unitId]/progress
 */
export default defineEventHandler(async (event): Promise<ResPayload<UnitProgressDetail | null>> => {
  const userId: number = event.context.user.id
  const unitId = Number(getRouterParam(event, 'unitId'))

  if (!unitId || isNaN(unitId)) {
    return validateError('无效的单元ID')
  }

  // 1. 查单元信息（联查 media 表获取封面音频）
  const units = await query<UnitRow & { unit_media_key: string | null }>(
    `SELECT u.*, m.object_key AS unit_media_key
     FROM unit u
     LEFT JOIN media m ON u.cover_media_id = m.id
     WHERE u.id = ?`,
    [unitId]
  )
  const unit = units[0]
  if (!unit) {
    return validateError('单元不存在', 404)
  }

  // 2. 查片段列表（联查 media 表获取音频）
  const segments = await query<
    { id: number; title: string; sortOrder: number; audioUrl: string | null; duration: string | null } 
    & { seg_media_key: string | null }
  >(
    `SELECT s.id, s.title, s.sort_order AS sortOrder, s.audioUrl, s.duration,
            m.object_key AS seg_media_key
     FROM segment s
     LEFT JOIN media m ON s.media_id = m.id
     WHERE s.unit_id = ?
     ORDER BY s.sort_order`,
    [unitId]
  )

  // 3. 查进度
  const progressRows = await query<UserProgressRow>(
    'SELECT * FROM user_progress WHERE user_id = ? AND segment_id IN (SELECT id FROM segment WHERE unit_id = ?)',
    [userId, unitId]
  )
  const progressMap = new Map(progressRows.map((r) => [r.segment_id, r]))

  // 4. 签名片段音频
  const segmentsWithProgress = await Promise.all(
    segments.map(async (s) => ({
      id: s.id,
      title: s.title,
      audioUrl: await signFromMedia(s.seg_media_key, s.audioUrl, MATERIAL_EXPIRE),
      sortOrder: s.sortOrder,
      progress: (() => {
        const p = progressMap.get(s.id)
        return p
          ? {
              phase1_done: p.phase1_done === 1,
              phase2_done: p.phase2_done === 1,
              phase3_done: p.phase3_done === 1,
              phase3_score: p.phase3_score ? Number(p.phase3_score) : null,
              phase4_done: p.phase4_done === 1,
              phase4_score: p.phase4_score ? Number(p.phase4_score) : null,
              updatedAt: p.updatedAt,
            }
          : {
              phase1_done: false,
              phase2_done: false,
              phase3_done: false,
              phase3_score: null,
              phase4_done: false,
              phase4_score: null,
              updatedAt: null,
            }
      })(),
    }))
  )

  // 5. 组合返回
  const result: UnitProgressDetail = {
    unit: {
      id: unit.id,
      title: unit.title,
      description: unit.description,
      level: unit.level,
      sortOrder: unit.sort_order,
      audioUrl: await signFromMedia(unit.unit_media_key, null, MATERIAL_EXPIRE),
    },
    segments: segmentsWithProgress,
  }

  return validateSuccess(result, '获取成功')
})