import { query } from '#server/utils/db'
import type { ProgressDetailRow, CountRow } from '#server/types/db'
import { mapProgressRow } from '#shared/utils/progress'

/**
 * 获取用户整体学习进度
 * GET /api/user/progress
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id

  if (!userId) {
    return validateError('未登录', 401)
  }

  const rows = await query<ProgressDetailRow>(
    `SELECT up.*, s.title as segmentTitle, s.unit_id, u.title as unitTitle
     FROM user_progress up
     JOIN segment s ON up.segment_id = s.id AND s.deleted_at IS NULL
     JOIN unit u ON s.unit_id = u.id
     WHERE up.user_id = ? AND up.deleted_at IS NULL
     ORDER BY u.level, u.sort_order, s.sort_order`,
    [userId]
  )

  // 统计数据
  const totalSegments = rows.length
  const completedPhases = rows.reduce((acc, row) => {
    return {
      phase1: acc.phase1 + (row.phase1_done ? 1 : 0),
      phase2: acc.phase2 + (row.phase2_done ? 1 : 0),
      phase3: acc.phase3 + (row.phase3_done ? 1 : 0),
      phase4: acc.phase4 + (row.phase4_done ? 1 : 0)
    }
  }, { phase1: 0, phase2: 0, phase3: 0, phase4: 0 })

  const allSegmentsRows = await query<CountRow>('SELECT COUNT(*) as total FROM segment WHERE deleted_at IS NULL')
  const totalSegmentsAll = allSegmentsRows[0]?.total ?? 0

  // 完全完成的片段数（四阶段都完成）
  const completedSegments = rows.filter(row => 
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
    details: rows.map(row => ({
      segmentId: row.segment_id,
      segmentTitle: row.segmentTitle,
      unitId: row.unit_id,
      unitTitle: row.unitTitle,
      ...mapProgressRow(row),
    }))
  }, '获取用户进度成功', 200)
})
