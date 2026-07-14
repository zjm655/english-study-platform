import pool from '#server/utils/db'

/**
 * 获取用户整体学习进度
 * GET /api/user/progress
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id

  if (!userId) {
    return validateError('未登录', 401)
  }

  // 获取用户的所有进度记录
  const [progressRows] = await pool.execute(
    `SELECT up.*, s.title as segmentTitle, s.unit_id, u.title as unitTitle
     FROM user_progress up
     JOIN segment s ON up.segment_id = s.id
     JOIN unit u ON s.unit_id = u.id
     WHERE up.user_id = ? AND up.deleted_at IS NULL
     ORDER BY u.level, u.sort_order, s.sort_order`,
    [userId]
  )

  // 统计数据
  const totalSegments = (progressRows as any[]).length
  const completedPhases = (progressRows as any[]).reduce((acc: any, row: any) => {
    return {
      phase1: acc.phase1 + (row.phase1_done ? 1 : 0),
      phase2: acc.phase2 + (row.phase2_done ? 1 : 0),
      phase3: acc.phase3 + (row.phase3_done ? 1 : 0),
      phase4: acc.phase4 + (row.phase4_done ? 1 : 0)
    }
  }, { phase1: 0, phase2: 0, phase3: 0, phase4: 0 })

  // 获取所有片段总数（用于计算整体进度百分比）
  const [allSegments] = await pool.execute(
    'SELECT COUNT(*) as total FROM segment'
  )
  const totalSegmentsAll = (allSegments as any[])[0].total

  // 完全完成的片段数（四阶段都完成）
  const completedSegments = (progressRows as any[]).filter((row: any) => 
    row.phase1_done && row.phase2_done && row.phase3_done && row.phase4_done
  ).length

  return validateSuccess({
    summary: {
      totalSegmentsAll,
      progressRecords: totalSegments,
      completedSegments,
      completedPhases,
      overallPercent: totalSegmentsAll > 0 
        ? Math.round((completedSegments / totalSegmentsAll) * 100) 
        : 0
    },
    details: (progressRows as any[]).map(row => ({
      segmentId: row.segment_id,
      segmentTitle: row.segmentTitle,
      unitId: row.unit_id,
      unitTitle: row.unitTitle,
      phase1_done: !!row.phase1_done,
      phase2_done: !!row.phase2_done,
      phase3_done: !!row.phase3_done,
      phase3_score: row.phase3_score ? Number(row.phase3_score) : null,
      phase4_done: !!row.phase4_done,
      phase4_score: row.phase4_score ? Number(row.phase4_score) : null,
      updatedAt: row.updatedAt
    }))
  }, '获取用户进度成功', 200)
})
