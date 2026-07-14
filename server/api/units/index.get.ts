import pool from '#server/utils/db'

/**
 * 获取单元列表（含进度摘要）
 * GET /api/units
 * Query: ?level=1 (可选，按难度筛选)
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  const query = getQuery(event)
  const level = query.level ? Number(query.level) : null

  // 构建查询条件
  let unitQuery = 'SELECT * FROM unit'
  const params: any[] = []
  
  if (level) {
    unitQuery += ' WHERE level = ?'
    params.push(level)
  }
  
  unitQuery += ' ORDER BY level, sort_order'

  const [units] = await pool.execute(unitQuery, params)

  // 获取每个单元的进度摘要
  const unitsWithProgress = await Promise.all(
    (units as any[]).map(async (unit) => {
      // 获取该单元的片段总数
      const [segments] = await pool.execute(
        'SELECT COUNT(*) as total FROM segment WHERE unit_id = ?',
        [unit.id]
      )
      const totalSegments = (segments as any[])[0].total

      // 获取已完成的片段数（四阶段全部完成）
      let completedSegments = 0
      if (userId && totalSegments > 0) {
        const [completed] = await pool.execute(
          `SELECT COUNT(DISTINCT segment_id) as completed 
           FROM user_progress 
           WHERE user_id = ? 
           AND segment_id IN (SELECT id FROM segment WHERE unit_id = ?)
           AND phase1_done = 1 AND phase2_done = 1 AND phase3_done = 1 AND phase4_done = 1`,
          [userId, unit.id]
        )
        completedSegments = (completed as any[])[0].completed
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
