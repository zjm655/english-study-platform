import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
import { isAdminOrAbove } from '#shared/utils/role'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { SegmentRow, VocabularyRow } from '#server/types/db'
import type { AdminSegmentDetail, AdminVocabEditItem } from '#shared/types/adminSegment'
import type { Question } from '#shared/types/unit'

/**
 * 管理员材料详情（原文/翻译/题目/词汇，供编辑页加载）
 * GET /api/admin/segment/[segId]
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const segId = Number(getRouterParam(event, 'segId'))
  if (!segId || isNaN(segId)) {
    return validateError('无效的片段ID')
  }

  // 1. 查材料（联查单元标题 + 音频 media + 上传记录归属用户），已删除的返回 404。
  //    契约纯增量：额外取音频 object_key/duration 与上传者 user_id/role，用于门禁试听判定。
  const segments = await query<
    SegmentRow & {
      unitTitle: string | null
      media_key: string | null
      media_duration: string | number | null
      uploader_user_id: number | null
      uploader_role: number | null
    }
  >(
    `SELECT s.*, u.title AS unitTitle,
            m.object_key AS media_key, m.duration AS media_duration,
            r.user_id AS uploader_user_id, uu.role AS uploader_role
     FROM segment s
     LEFT JOIN unit u ON s.unit_id = u.id
     LEFT JOIN media m ON s.media_id = m.id
     LEFT JOIN material_upload_record r ON r.segment_id = s.id
     LEFT JOIN user uu ON r.user_id = uu.id
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

  // 4. 门禁试听判定（口径同 ④a）：上传者为系统/管理员/超管，或材料公开 → 可直接播放；
  //    非公开的普通用户材料需审核权限 + 填理由 + 留痕（走 audition 端点），此处 audioUrl 返回 null。
  //    uploader_user_id 为空表示无上传记录（系统/管理员直建），视为可播放。
  const uploaderIsAdmin = segment.uploader_user_id === null || isAdminOrAbove(segment.uploader_role)
  const playable = uploaderIsAdmin || segment.is_public === 1
  const hasAudio = !!segment.media_key
  const audioUrl =
    playable && segment.media_key ? await signUrl(segment.media_key, MATERIAL_EXPIRE) : null
  const audioLocked = !playable && hasAudio
  // 公开状态门禁（口径同试听）：非公开的用户材料其公开状态变更需走 REVIEW 门禁 + 留痕。
  const visibilityLocked = !playable
  const duration = segment.media_duration != null ? Number(segment.media_duration) : null

  const detail: AdminSegmentDetail = {
    id: segment.id,
    title: segment.title,
    textContent: segment.textContent,
    translation: segment.translation,
    questions,
    isPublic: segment.is_public,
    nlsCheck: segment.nls_check ?? 0,
    unitId: segment.unit_id,
    unitTitle: segment.unitTitle ?? '',
    vocabulary,
    audioUrl,
    duration,
    audioLocked,
    visibilityLocked,
  }
  return validateSuccess(detail, '获取材料详情成功')
})
