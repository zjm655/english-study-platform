import { readBody } from 'h3'
import { query, withTransaction } from '#server/utils/db'
import { adminSegmentUpdateSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 管理员编辑材料（仅保存文本字段，不触发 TTS/AI 再生成）
 * PUT /api/admin/segment/[segId]
 *
 * 词汇采用 diff 策略：带 id → UPDATE（不触碰 media_id，保护 TTS 音频关联）；
 * 无 id → INSERT（media_id=NULL，新词无音频为预期）；库中有但 payload 未含 → DELETE。
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

  const body = await readBody(event)
  const parsed = adminSegmentUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { title, textContent, translation, questions, vocabulary, isPublic } = parsed.data

  // 校验材料存在且未删除，并取当前 is_public（payload 未传时保持不变）
  const existing = await query<{ id: number; is_public: number }>(
    'SELECT id, is_public FROM segment WHERE id = ? AND deleted_at IS NULL',
    [segId]
  )
  if (existing.length === 0) {
    return validateError('材料不存在或已删除', 404)
  }

  const finalIsPublic = isPublic ?? existing[0]!.is_public
  // 空翻译归一为 null（与无翻译材料的存储约定一致）
  const finalTranslation = translation == null || translation === '' ? null : translation
  // 空题目数组归一为 null（与无题目材料的存储约定一致）
  const finalQuestions = questions == null || questions.length === 0 ? null : JSON.stringify(questions)

  try {
    await withTransaction(async (conn) => {
      // 1. 更新 segment 文本字段（questions 已 JSON.stringify，避免写入 [object Object]）
      await conn.execute(
        `UPDATE segment
         SET title = ?, textContent = ?, translation = ?, questions = ?, is_public = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [title, textContent, finalTranslation, finalQuestions, finalIsPublic, segId]
      )

      // 2. 词汇 diff（payload 未传 vocabulary 时不动词汇）
      if (vocabulary != null) {
        const keepIds = vocabulary.filter(v => v.id != null).map(v => v.id as number)

        // 2a. 删除 payload 中未保留的词汇
        if (keepIds.length > 0) {
          const placeholders = keepIds.map(() => '?').join(', ')
          await conn.execute(
            `DELETE FROM vocabulary WHERE segment_id = ? AND id NOT IN (${placeholders})`,
            [segId, ...keepIds]
          )
        } else {
          // payload 无带 id 项 → 清空该材料的全部词汇
          await conn.execute('DELETE FROM vocabulary WHERE segment_id = ?', [segId])
        }

        // 2b. 更新已有 / 插入新增（sort_order 取数组下标）
        for (let i = 0; i < vocabulary.length; i++) {
          const v = vocabulary[i]!
          const forms = v.forms ?? null
          const phonetic = v.phonetic ?? null
          const exampleSentence = v.exampleSentence ?? null
          const exampleTranslation = v.exampleTranslation ?? null
          if (v.id != null) {
            // UPDATE 只列文本字段，严禁触碰 media_id（保护 TTS 音频关联）
            await conn.execute(
              `UPDATE vocabulary
               SET word = ?, forms = ?, phonetic = ?, meaning = ?,
                   exampleSentence = ?, exampleTranslation = ?, sort_order = ?
               WHERE id = ? AND segment_id = ?`,
              [v.word, forms, phonetic, v.meaning, exampleSentence, exampleTranslation, i, v.id, segId]
            )
          } else {
            // INSERT 新词 media_id=NULL（不触发 TTS 再生成，无音频为预期行为）
            await conn.execute(
              `INSERT INTO vocabulary
                 (segment_id, word, forms, phonetic, meaning, exampleSentence, exampleTranslation, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [segId, v.word, forms, phonetic, v.meaning, exampleSentence, exampleTranslation, i]
            )
          }
        }
      }
    })
  } catch (err) {
    logger.error('[admin segment] 编辑失败:', err)
    return validateError('保存失败，请稍后重试', 500)
  }

  await logAdminOperation(user.id, 'segment.update', 'segment', segId, { title })
  return validateSuccess(null, '保存成功')
})
