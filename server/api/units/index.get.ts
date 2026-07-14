import { query } from '#server/utils/db'
import type { UnitRow, CountRow } from '#server/types/db'

/**
 * 获取单元列表（含进度摘要）
 * GET /api/units
 * Query: ?level=1 (可选，按难度筛选)
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  const levelQuery = getQuery(event).level
  const level = levelQuery ? Number(levelQuery) : null

  // 构建查询条件
  let unitSql = 'SELECT * FROM unit'
  const params: number[] = []
  
  if (level) {
    unitSql += ' WHERE level = ?'
    params.push(level)
  }
  
  unitSql += ' ORDER BY level, sort_order'

  const units = await query<UnitRow>(unitSql, params)

  // 获取每个单元的进度摘要
  const unitsWithProgress = await Promise.all(
    units.map(async (unit) => {
      const countRows = await query<CountRow>(
        'SELECT COUNT(*) as total FROM segment WHERE unit_id = ?',
        [unit.id]
      )
      const totalSegments = countRows[0]?.total ?? 0

      let completedSegments = 0
      if (userId && totalSegments > 0) {
        const completedRows = await query<CountRow>(
          `SELECT COUNT(DISTINCT segment_id) as completed 
           FROM user_progress 
           WHERE user_id = ? 
           AND segment_id IN (SELECT id FROM segment WHERE unit_id = ?)
           AND phase1_done = 1 AND phase2_done = 1 AND phase3_done = 1 AND phase4_done = 1`,
          [userId, unit.id]
        )
        completedSegments = completedRows[0]?.completed ?? 0
      }

      return {
        ...unit,
        progress: {
          totalSegments,
          completedSegments,
          percent: totalSegments > 0 ? Math.round((completedSegments / totalSegments) * 100) : 0
        }
      }
    })
  )

  return validateSuccess(unitsWithProgress, '获取单元列表成功', 200)
})
