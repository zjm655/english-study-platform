import { query } from '#server/utils/db'
import type { UnitRow, SegmentRow, UserProgressRow } from '#server/types/db'

/**
 * 获取某单元的详细进度（每个片段的四阶段完成情况）
 * GET /api/units/:unitId/progress
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  const unitId = getRouterParam(event, 'unitId')

  if (!unitId) {
    return validateError('缺少单元ID', 400)
  }

  const units = await query<UnitRow>('SELECT * FROM unit WHERE id = ?', [unitId])
  const unit = units[0]
  
  if (!unit) {
    return validateError('单元不存在', 404)
  }

  const segments = await query<SegmentRow>(
    'SELECT * FROM segment WHERE unit_id = ? ORDER BY sort_order',
    [unitId]
  )

  const segmentsWithProgress = await Promise.all(
    segments.map(async (segment) => {
      let progress: UserProgressRow | null = null
      
      if (userId) {
        const rows = await query<UserProgressRow>(
          `SELECT phase1_done, phase2_done, phase3_done, phase3_score, 
                  phase4_done, phase4_score, updatedAt
           FROM user_progress 
           WHERE user_id = ? AND segment_id = ? AND deleted_at IS NULL`,
          [userId, segment.id]
        )
        progress = rows[0] || null
      }

      return {
        id: segment.id,
        title: segment.title,
        audioUrl: segment.audioUrl,
        sortOrder: segment.sort_order,
        progress: progress ? {
          phase1_done: !!progress.phase1_done,
          phase2_done: !!progress.phase2_done,
          phase3_done: !!progress.phase3_done,
          phase3_score: progress.phase3_score ? Number(progress.phase3_score) : null,
          phase4_done: !!progress.phase4_done,
          phase4_score: progress.phase4_score ? Number(progress.phase4_score) : null,
          updatedAt: progress.updatedAt
        } : {
          phase1_done: false,
          phase2_done: false,
          phase3_done: false,
          phase3_score: null,
          phase4_done: false,
          phase4_score: null,
          updatedAt: null
        }
      }
    })
  )

  return validateSuccess({
    unit,
    segments: segmentsWithProgress
  }, '获取单元进度成功', 200)
})
