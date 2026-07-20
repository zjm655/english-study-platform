import { query } from '#server/utils/db'
import { signUrl, MATERIAL_EXPIRE } from '#server/utils/oss'
import { validateError, validateSuccess, reviewQuerySchema } from '#server/utils/validate'
import type { SegmentRow } from '#server/types/db'
import type { ReviewMaterialItem } from '#shared/types/review'
import type { Question } from '#shared/types/unit'

/** 将数据库 JSON 列的多种形态（数组/字符串/null）规整为 Question[] | null */
function parseQuestions(raw: Question[] | string | null): Question[] | null {
  if (raw === null) return null
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 将数据库行 + 签名 URL 列表转换为复习材料项（duration 从 DECIMAL 字符串转 number） */
export function rowsToReviewMaterial(
  rows: (SegmentRow & { seg_media_key: string | null; seg_media_duration: string | null })[],
  signedAudioUrls: (string | null)[]
): ReviewMaterialItem[] {
  return rows.map((row, i) => ({
    id: row.id,
    title: row.title,
    audioUrl: signedAudioUrls[i] ?? null,
    questions: parseQuestions(row.questions),
    duration: row.seg_media_duration ? Number(row.seg_media_duration) : null,
  }))
}

/**
 * 获取材料复习列表（phase2 已完成的片段）
 * 请求：GET /api/review/material?limit=5
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
  const { limit = 5 } = result.data

  // 联查 user_progress + segment + media（duration 取自 media 表）
  const rows = await query<
    SegmentRow & { seg_media_key: string | null; seg_media_duration: string | null }
  >(
    `SELECT s.id, s.title, s.questions,
            m.object_key AS seg_media_key, m.duration AS seg_media_duration
     FROM user_progress up
     JOIN segment s ON up.segment_id = s.id AND s.deleted_at IS NULL
     LEFT JOIN media m ON s.media_id = m.id
     WHERE up.user_id = ? AND up.phase2_done = 1 AND up.deleted_at IS NULL
     ORDER BY up.updatedAt DESC
     LIMIT ?`,
    [userId, limit]
  )

  // 对每行签名音频（seg_media_key 为 null 时返回 null）
  const signedAudioUrls = await Promise.all(
    rows.map((row) => (row.seg_media_key ? signUrl(row.seg_media_key, MATERIAL_EXPIRE) : null))
  )

  const items = rowsToReviewMaterial(rows, signedAudioUrls)

  return validateSuccess(items, '获取材料复习列表成功')
})
