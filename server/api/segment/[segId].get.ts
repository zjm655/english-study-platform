import { query } from '#server/utils/db'
import type { SegmentRow, UnitRow, VocabularyRow, UserProgressRow } from '#server/types/db'
import type { SegmentDetail, SegmentPhaseProgress, VocabularyItem } from '#shared/types/unit'

/**
 * 获取片段详情
 * 请求：GET /api/segment/[segId]
 */
export default defineEventHandler(async (event): Promise<ResPayload<SegmentDetail | null>> => {
  const userId: number = event.context.user.id
  const segId = Number(getRouterParam(event, 'segId'))

  if (!segId || isNaN(segId)) {
    return validateError('无效的片段ID')
  }

  // 1. 查片段信息
  const segments = await query<SegmentRow>(
    'SELECT * FROM segment WHERE id = ?',
    [segId]
  )
  const segment = segments[0]
  if (!segment) {
    return validateError('片段不存在', 404)
  }

  // 2. 查单元信息（面包屑用）
  const units = await query<UnitRow>(
    'SELECT id, title FROM unit WHERE id = ?',
    [segment.unit_id]
  )
  const unit = units[0]
  if (!unit) {
    return validateError('单元不存在', 404)
  }

  // 3. 查重点词
  const vocabRows = await query<VocabularyRow>(
    'SELECT * FROM vocabulary WHERE segment_id = ? ORDER BY sort_order',
    [segId]
  )
  const vocabulary: VocabularyItem[] = vocabRows.map(v => ({
    id: v.id,
    word: v.word,
    forms: v.forms,
    phonetic: v.phonetic,
    meaning: v.meaning,
    audioUrl: v.audioUrl,
  }))

  // 4. 查用户进度
  const progressRows = await query<UserProgressRow>(
    'SELECT * FROM user_progress WHERE user_id = ? AND segment_id = ?',
    [userId, segId]
  )
  const progressRow = progressRows[0]

  const progress: SegmentPhaseProgress = progressRow
    ? {
        phase1_done: progressRow.phase1_done === 1,
        phase2_done: progressRow.phase2_done === 1,
        phase3_done: progressRow.phase3_done === 1,
        phase3_score: progressRow.phase3_score ? Number(progressRow.phase3_score) : null,
        phase4_done: progressRow.phase4_done === 1,
        phase4_score: progressRow.phase4_score ? Number(progressRow.phase4_score) : null,
        updatedAt: progressRow.updatedAt,
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

  // 5. 组合返回
  const result: SegmentDetail = {
    id: segment.id,
    title: segment.title,
    audioUrl: segment.audioUrl,
    textContent: segment.textContent,
    translation: segment.translation,
    questions: segment.questions,
    unitId: unit.id,
    unitTitle: unit.title,
    vocabulary,
    progress,
  }

  return validateSuccess(result, '获取成功')
})
