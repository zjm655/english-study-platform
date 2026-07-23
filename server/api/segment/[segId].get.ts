import { query } from '#server/utils/db'
import { signUrl, MATERIAL_EXPIRE, WORD_EXPIRE } from '#server/utils/oss'
import type { SegmentRow, UnitRow, VocabularyRow, UserProgressRow } from '#server/types/db'
import type { SegmentDetail, SegmentPhaseProgress, VocabularyItem } from '#shared/types/unit'
import { mapProgressRow, DEFAULT_PROGRESS } from '#shared/utils/progress'

/**
 * 生成签名 URL：使用 media 表的 object_key
 */
async function signFromMedia(
  objectKey: string | null,
  expires: number = MATERIAL_EXPIRE,
): Promise<string | null> {
  if (!objectKey) return null
  return signUrl(objectKey, expires)
}

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

  // 1. 查片段信息（联查 media 表获取音频）
  const segments = await query<
    SegmentRow & { seg_media_key: string | null; seg_media_duration: string | null }
  >(
    `SELECT s.*, m.object_key AS seg_media_key, m.duration AS seg_media_duration
     FROM segment s
     LEFT JOIN media m ON s.media_id = m.id
     WHERE s.id = ? AND s.deleted_at IS NULL`,
    [segId],
  )
  const segment = segments[0]
  if (!segment) {
    return validateError('片段不存在', 404)
  }

  // 2. 查单元信息（面包屑用）
  const units = await query<UnitRow>('SELECT id, title FROM unit WHERE id = ?', [segment.unit_id])
  const unit = units[0]
  if (!unit) {
    return validateError('单元不存在', 404)
  }

  // 3. 查重点词（联查 media 表获取音频）
  type VocabMediaRow = VocabularyRow & {
    vocab_media_key: string | null
    vocab_media_duration: string | null
  }
  const vocabRows = await query<VocabMediaRow>(
    `SELECT v.*, m.object_key AS vocab_media_key, m.duration AS vocab_media_duration
     FROM vocabulary v
     LEFT JOIN media m ON v.media_id = m.id
     WHERE v.segment_id = ?
     ORDER BY v.sort_order`,
    [segId],
  )
  const vocabulary: VocabularyItem[] = await Promise.all(
    vocabRows.map(async (v) => ({
      id: v.id,
      word: v.word,
      forms: v.forms,
      phonetic: v.phonetic,
      meaning: v.meaning,
      audioUrl: await signFromMedia(v.vocab_media_key, WORD_EXPIRE),
      duration: v.vocab_media_duration ? Number(v.vocab_media_duration) : null,
    })),
  )

  // 4. 查用户进度
  const progressRows = await query<UserProgressRow>(
    'SELECT * FROM user_progress WHERE user_id = ? AND segment_id = ?',
    [userId, segId],
  )
  const progressRow = progressRows[0]

  const progress = progressRow ? mapProgressRow(progressRow) : { ...DEFAULT_PROGRESS }

  // mapProgressRow 的 updatedAt 可能是 Date（MySQL 驱动返回），
  // SegmentPhaseProgress 要求 string | null | undefined
  const progressConverted: SegmentPhaseProgress = {
    ...progress,
    updatedAt:
      progress.updatedAt instanceof Date
        ? progress.updatedAt.toISOString()
        : (progress.updatedAt ?? undefined),
  }

  // 5. 组合返回
  const result: SegmentDetail = {
    id: segment.id,
    title: segment.title,
    audioUrl: await signFromMedia(segment.seg_media_key, MATERIAL_EXPIRE),
    duration: segment.seg_media_duration ? Number(segment.seg_media_duration) : null,
    textContent: segment.textContent,
    translation: segment.translation,
    questions: segment.questions,
    unitId: unit.id,
    unitTitle: unit.title,
    vocabulary,
    progress: progressConverted,
  }

  return validateSuccess(result, '获取成功')
})
