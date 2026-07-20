import { query } from '#server/utils/db'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
import type { UnitRow } from '#server/types/db'
import type { UnitWithProgress, UnitProgressSummary } from '#shared/types/unit'

/**
 * 获取单元列表（含进度）
 * 请求：GET /api/units?level=xxx（可选，不传则返回全部）
 */
export default defineEventHandler(async (event): Promise<ResPayload<UnitWithProgress[]>> => {
  const userId: number = event.context.user.id
  const rawLevel = getQuery(event).level
  const hasLevel = rawLevel !== undefined && rawLevel !== ''
  const level = Number(rawLevel)
  const validLevel = hasLevel && !isNaN(level)

  // 1. 查单元列表（联查 media 表获取封面）
  const units = validLevel
    ? await query<UnitRow & { unit_media_key: string | null }>(
        `SELECT u.*, m.object_key AS unit_media_key
         FROM unit u
         LEFT JOIN media m ON u.cover_media_id = m.id
         WHERE u.level = ?
         ORDER BY u.sort_order`,
        [level]
      )
    : await query<UnitRow & { unit_media_key: string | null }>(
        `SELECT u.*, m.object_key AS unit_media_key
         FROM unit u
         LEFT JOIN media m ON u.cover_media_id = m.id
         ORDER BY u.level, u.sort_order`
      )

  // 2. 查该用户所有已学习片段（单元内去重）
  const progressRows = validLevel
    ? await query<{ segment_id: number; unit_id: number }>(
        `SELECT DISTINCT up.segment_id, s.unit_id
         FROM user_progress up
         JOIN segment s ON up.segment_id = s.id AND s.deleted_at IS NULL
         WHERE up.user_id = ? AND s.unit_id IN (SELECT id FROM unit WHERE level = ?)`,
        [userId, level]
      )
    : await query<{ segment_id: number; unit_id: number }>(
        `SELECT DISTINCT up.segment_id, s.unit_id
         FROM user_progress up
         JOIN segment s ON up.segment_id = s.id AND s.deleted_at IS NULL
         WHERE up.user_id = ?`,
        [userId]
      )
  const progressMap = new Map<number, Set<number>>()
  for (const row of progressRows) {
    if (!progressMap.has(row.unit_id)) progressMap.set(row.unit_id, new Set())
    progressMap.get(row.unit_id)!.add(row.segment_id)
  }

  // 3. 查每个单元的总片段数
  const segmentCounts = validLevel
    ? await query<{ unit_id: number; count: number }>(
        `SELECT unit_id, COUNT(*) as count FROM segment WHERE unit_id IN (SELECT id FROM unit WHERE level = ?) AND deleted_at IS NULL GROUP BY unit_id`,
        [level]
      )
    : await query<{ unit_id: number; count: number }>(
        `SELECT unit_id, COUNT(*) as count FROM segment WHERE deleted_at IS NULL GROUP BY unit_id`
      )
  const countMap = new Map(segmentCounts.map((r) => [r.unit_id, r.count]))

  // 4. 组合返回
  const result: UnitWithProgress[] = await Promise.all(
    units.map(async (unit) => {
      const totalSegments = countMap.get(unit.id) ?? 0
      const completedSegments = progressMap.get(unit.id)?.size ?? 0
      const progress: UnitProgressSummary = {
        totalSegments,
        completedSegments,
        percent: totalSegments > 0 ? Math.round((completedSegments / totalSegments) * 100) : 0,
      }

      return {
        id: unit.id,
        title: unit.title,
        description: unit.description,
        level: unit.level,
        sortOrder: unit.sort_order,
        audioUrl: await signFromMedia(unit.unit_media_key, MATERIAL_EXPIRE),
        progress,
      }
    })
  )

  return validateSuccess(result, '获取成功')
})

/** 生成签名 URL：使用 media 表的 object_key */
async function signFromMedia(
  objectKey: string | null,
  expires: number = MATERIAL_EXPIRE
): Promise<string | null> {
  if (objectKey) return signUrl(objectKey, expires)
  return null
}