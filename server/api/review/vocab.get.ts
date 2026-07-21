import { query } from '#server/utils/db'
import { signUrl, WORD_EXPIRE } from '#server/utils/oss'
import { validateError, validateSuccess, reviewQuerySchema } from '#server/utils/validate'
import type { ReviewVocabItem } from '#shared/types/review'
import type { VocabularyRow, UserProgressRow } from '#server/types/db'

/** 将数据库行 + 签名 URL 列表转换为复习词汇项 */
export function rowsToReviewVocab(
  rows: (VocabularyRow & { vocab_media_key: string | null })[],
  signedAudioUrls: (string | null)[]
): ReviewVocabItem[] {
  return rows.map((row, i) => ({
    id: row.id,
    segmentId: row.segment_id,
    word: row.word,
    phonetic: row.phonetic,
    meaning: row.meaning,
    forms: row.forms,
    exampleSentence: row.exampleSentence,
    exampleTranslation: row.exampleTranslation,
    audioUrl: signedAudioUrls[i] ?? null,
  }))
}

/**
 * 获取单词复习列表
 * GET /api/review/vocab?limit=10
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id
  if (!userId) {
    return validateError('未登录', 401)
  }

  const result = reviewQuerySchema.safeParse(getQuery(event))
  if (!result.success) {
    return validateError(result.error.issues[0]?.message || '参数校验失败', 400)
  }
  const { limit = 10, offset = 0, keyword } = result.data

  const keywordPattern = keyword ? `%${keyword}%` : null

  // 查询用户最近学过的 segment_id（JOIN segment 过滤已软删除的材料，避免其单词进入复习）
  const progressRows = await query<Pick<UserProgressRow, 'segment_id'>>(
    `SELECT up.segment_id FROM user_progress up
     JOIN segment s ON up.segment_id = s.id AND s.deleted_at IS NULL
     WHERE up.user_id = ? AND up.phase2_done = 1 AND up.deleted_at IS NULL
     ORDER BY up.updatedAt DESC`,
    [userId]
  )

  if (progressRows.length === 0) {
    return validateSuccess({ items: [], total: 0 }, '获取成功')
  }

  const segmentIds = progressRows.map(r => r.segment_id)
  const placeholders = segmentIds.map(() => '?').join(', ')

  // 构建关键词过滤条件
  const keywordClause = keywordPattern
    ? 'AND (v.word LIKE ? OR v.meaning LIKE ?)'
    : ''
  const keywordParams = keywordPattern ? [keywordPattern, keywordPattern] : []

  // 查询总数
  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM vocabulary v
     WHERE v.segment_id IN (${placeholders})
     ${keywordClause}`,
    [...segmentIds, ...keywordParams]
  )
  const total = countResult[0]?.total ?? 0

  // 联查 vocabulary + media
  const vocabRows = await query<VocabularyRow & { vocab_media_key: string | null }>(
    `SELECT v.*, m.object_key AS vocab_media_key
     FROM vocabulary v
     LEFT JOIN media m ON v.media_id = m.id
     WHERE v.segment_id IN (${placeholders})
     ${keywordClause}
     ORDER BY v.segment_id, v.sort_order
     LIMIT ? OFFSET ?`,
    [...segmentIds, ...keywordParams, limit, offset]
  )

  // 签名音频
  const signedAudioUrls = await Promise.all(
    vocabRows.map(row =>
      row.vocab_media_key ? signUrl(row.vocab_media_key, WORD_EXPIRE) : null
    )
  )

  return validateSuccess({ items: rowsToReviewVocab(vocabRows, signedAudioUrls), total }, '获取成功')
})
