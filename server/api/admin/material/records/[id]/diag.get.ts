import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
import { isAdminOrAbove } from '#shared/utils/role'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type {
  AdminMaterialRecordDiag,
  PipelineSnapshotView,
} from '#shared/types/adminMaterialRecord'
import type { MaterialUploadStatus } from '#shared/types/material'

/**
 * 管理员获取上传记录诊断详情（含流水线快照/说话人标注/音频/成功时的学习产物）
 * GET /api/admin/material/records/:id/diag（权限 MANAGE_MATERIALS）
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id) || id <= 0) return validateError('无效的记录ID')

  const rows = await query<
    {
      id: number
      title: string
      text_content: string
      voice: string
      status: MaterialUploadStatus
      error_message: string | null
      nls_check: number
      nls_transcript: string | null
      speaker_annotated: string | null
      pipeline_snapshot: string | null
      is_public: number
      segment_id: number | null
      createdAt: string
      updatedAt: string
      username: string
      role: number | null
      media_key: string | null
    }
  >(
    `SELECT r.id, r.text_content, r.title, r.voice, r.status, r.error_message,
            r.nls_check, r.nls_transcript, r.speaker_annotated, r.pipeline_snapshot,
            r.is_public, r.segment_id, r.createdAt, r.updatedAt,
            COALESCE(u.account, '已注销用户') AS username, u.role,
            m.object_key AS media_key
     FROM material_upload_record r
     LEFT JOIN user u ON r.user_id = u.id
     LEFT JOIN segment s ON r.segment_id = s.id
     LEFT JOIN media m ON s.media_id = m.id
     WHERE r.id = ?`,
    [id],
  )
  if (!rows.length) return validateError('记录不存在', 404)
  const row = rows[0]!

  const canAudition = isAdminOrAbove(row.role) || row.is_public === 1
  const audioUrl = canAudition && row.media_key ? await signUrl(row.media_key, MATERIAL_EXPIRE) : null

  let snapshot: PipelineSnapshotView | null = null
  if (row.pipeline_snapshot) {
    try {
      snapshot = JSON.parse(row.pipeline_snapshot) as PipelineSnapshotView
    } catch {
      snapshot = null
    }
  }

  // NLS 转写：优先 column；历史失败记录（转写未落库）回退取快照 stt 阶段文本，避免「有识别无转写」
  let nlsTranscript: string | null = row.nls_transcript
  if (!nlsTranscript && snapshot) {
    const sttStage = snapshot.stages.find((s) => s.name === 'stt')
    const sttText = (sttStage?.detail as { text?: string } | null | undefined)?.text
    if (sttText) nlsTranscript = sttText
  }

  // 成功记录：从 segment 取词汇/题目/翻译
  let segment: AdminMaterialRecordDiag['segment'] = null
  if (row.status === 'success' && row.segment_id) {
    const segRows = await query<{ translation: string | null; questions: string | null }>(
      `SELECT translation, questions FROM segment WHERE id = ? AND deleted_at IS NULL`,
      [row.segment_id],
    )
    const vocabRows = await query<Record<string, unknown>>(
      `SELECT v.word, v.forms, v.phonetic, v.meaning, v.exampleSentence, v.exampleTranslation,
              (m.object_key IS NOT NULL) AS has_audio
       FROM vocabulary v
       LEFT JOIN media m ON v.media_id = m.id AND m.status = 1
       WHERE v.segment_id = ?
       ORDER BY v.sort_order`,
      [row.segment_id],
    )
    const seg = segRows[0]
    let questions: unknown = null
    if (seg?.questions) {
      try {
        questions = JSON.parse(seg.questions)
      } catch {
        questions = null
      }
    }
    segment = {
      translation: seg?.translation ?? null,
      questions,
      vocabulary: vocabRows.map((v) => ({ ...(v as Record<string, unknown>) })),
    }
  }

  const detail: AdminMaterialRecordDiag = {
    id: row.id,
    title: row.title,
    status: row.status,
    source: isAdminOrAbove(row.role) ? 'admin' : 'user',
    nls_check: row.nls_check,
    text_content: row.text_content,
    voice: row.voice,
    error_message: row.error_message ?? null,
    nls_transcript: nlsTranscript,
    speaker_annotated: row.speaker_annotated ?? null,
    pipeline_snapshot: snapshot,
    audioUrl,
    username: row.username,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    segment,
  }

  return validateSuccess(detail, '获取诊断详情成功')
})