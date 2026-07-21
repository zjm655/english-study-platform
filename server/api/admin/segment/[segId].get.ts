import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import type { SegmentRow, VocabularyRow } from '#server/types/db'
import type { AdminSegmentDetail, AdminVocabEditItem } from '#shared/types/adminSegment'
import type { Question } from '#shared/types/unit'

/**
 * 管理员材料详情（原文/翻译/题目/词汇，供编辑页加载）
 * GET /api/admin/segment/[segId]
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const segId = Number(getRouterParam(event, 'segId'))
  if (!segId || isNaN(segId)) {
    return validateError('无效的片段ID')
  }

  // 1. 查材料（联查单元标题），已删除的返回 404
  const segments = await query<SegmentRow & { unitTitle: string | null }>(
    `SELECT s.*, u.title AS unitTitle
     FROM segment s
     LEFT JOIN unit u ON s.unit_id = u.id
     WHERE s.id = ? AND s.deleted_at IS NULL`,
    [segId],
  )
  const segment = segments[0]
  if (!segment) {
    return validateError('材料不存在或已删除', 404)
  }

  // 2. 查词汇列表（编辑用，不含音频签名）
  const vocabRows = await query<VocabularyRow>(
    'SELECT * FROM vocabulary WHERE segment_id = ? ORDER BY sort_order',
    [segId],
  )
  const vocabulary: AdminVocabEditItem[] = vocabRows.map((v) => ({
    id: v.id,
    word: v.word,
    forms: v.forms,
    phonetic: v.phonetic,
    meaning: v.meaning,
    exampleSentence: v.exampleSentence,
    exampleTranslation: v.exampleTranslation,
  }))

  // 3. questions 为 json 列：mysql2 自动解析为数组，兼容字符串
  const questions: Question[] = Array.isArray(segment.questions)
    ? segment.questions
    : segment.questions
      ? JSON.parse(segment.questions)
      : []

  const detail: AdminSegmentDetail = {
    id: segment.id,
    title: segment.title,
    textContent: segment.textContent,
    translation: segment.translation,
    questions,
    isPublic: segment.is_public,
    unitId: segment.unit_id,
    unitTitle: segment.unitTitle ?? '',
    vocabulary,
  }
  return validateSuccess(detail, '获取材料详情成功')
})
