import { randomUUID } from 'node:crypto'
import { isDialogueText, parseTxtFile } from './textParser'
import { generateLearningContent, generateTitle } from './aiContent'
import { textToSpeech } from './tts'
import { uploadWithKey } from './oss'
import { extractAudioMeta } from './audioMeta'
import { pool, withTransaction } from './db'
import { logger } from '../../shared/utils/logger'
import type { AdminUploadItemResult } from '../../shared/types/adminUpload'
import type { ResultSetHeader } from 'mysql2'

// ============ 管理员音频限制 ============
const ADMIN_MAX_DURATION = 600   // 10 分钟
const ADMIN_MAX_SIZE = 5 * 1024 * 1024   // 5MB

// ============ 记录追踪 ============

async function createUploadRecord(userId: number, title: string, textContent: string, voice: string, isPublic: number): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO material_upload_record (user_id, title, text_content, voice, is_public, status)
     VALUES (?, ?, ?, ?, ?, 'processing')`,
    [userId, title, textContent, voice, isPublic]
  )
  return res.insertId
}

async function updateRecordFailed(recordId: number, error: string) {
  await pool.execute(
    `UPDATE material_upload_record SET status = 'failed', error_message = ? WHERE id = ?`,
    [error.substring(0, 500), recordId]
  )
}

async function updateRecordSuccess(recordId: number, segmentId: number) {
  await pool.execute(
    `UPDATE material_upload_record SET status = 'success', segment_id = ? WHERE id = ?`,
    [segmentId, recordId]
  )
}

// ============ 核心处理函数 ============

export interface ProcessAdminMaterialParams {
  userId: number
  unitId: number
  textContent: string
  title: string | null
  voice: string
  isPublic: number
  bucket: string
  audioBuffer?: Buffer
  audioFileName?: string
}

export async function processAdminMaterial(params: ProcessAdminMaterialParams): Promise<AdminUploadItemResult> {
  const { userId, unitId, textContent, title, voice, isPublic, bucket, audioBuffer, audioFileName } = params

  // 1. 对话检测（免费正则）
  if (isDialogueText(textContent)) {
    return { index: 0, success: false, error: '材料为对话格式，不支持上传' }
  }

  const fallbackTitle = textContent.length > 50 ? textContent.slice(0, 50) + '...' : textContent
  let recordId: number

  try {
    recordId = await createUploadRecord(userId, title || fallbackTitle, textContent, voice, isPublic)
  } catch (err) {
    logger.error('[admin upload] 创建记录失败:', err)
    return { index: 0, success: false, error: '创建上传记录失败' }
  }

  try {
    // 2. 音频处理
    let audioBuffer_: Buffer
    let mediaType: string
    const ext = audioFileName ? audioFileName.split('.').pop()?.toLowerCase() || 'mp3' : 'mp3'

    if (audioBuffer) {
      audioBuffer_ = audioBuffer
      mediaType = 'user_material'
    } else {
      const ttsResult = await textToSpeech(textContent, voice)
      if (!ttsResult.success || !ttsResult.audio) {
        await updateRecordFailed(recordId, '音频生成失败')
        return { index: 0, success: false, error: '音频生成失败' }
      }
      audioBuffer_ = ttsResult.audio
      mediaType = 'tts'
    }

    // 3. OSS 上传
    const ossKey = `audio/material/${randomUUID()}.${ext}`
    try {
      await uploadWithKey(audioBuffer_, ossKey)
    } catch (err) {
      logger.error('[admin upload] OSS 上传失败:', err)
      await updateRecordFailed(recordId, '文件上传失败')
      return { index: 0, success: false, error: '文件上传失败' }
    }

    // 4. 插入 media 记录
    const originalName = audioFileName || 'tts.mp3'
    const [mediaRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, size_bytes, status)
       VALUES (?, ?, 'oss', ?, ?, ?, ?, ?, 1)`,
      [userId, mediaType, bucket, ossKey, originalName, `audio/${ext}`, audioBuffer_.length]
    )
    const segmentMediaId = mediaRes.insertId

    // 5. 音频元数据校验
    const meta = await extractAudioMeta(audioBuffer_)
    if (!meta) {
      await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
      await updateRecordFailed(recordId, '无法解析音频信息')
      return { index: 0, success: false, error: '无法解析音频信息' }
    }

    if (meta.duration > ADMIN_MAX_DURATION) {
      await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
      await updateRecordFailed(recordId, `音频时长超限: ${meta.duration.toFixed(1)}s`)
      return { index: 0, success: false, error: `音频时长超限` }
    }
    if (meta.size > ADMIN_MAX_SIZE) {
      await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
      await updateRecordFailed(recordId, `音频大小超限`)
      return { index: 0, success: false, error: '音频大小超限' }
    }

    await pool.execute('UPDATE media SET duration = ? WHERE id = ?', [meta.duration, segmentMediaId])

    // 6. AI 内容生成（翻译+词汇+题目）
    const aiResult = await generateLearningContent(textContent)
    if (!aiResult.success || !aiResult.vocabulary || !aiResult.questions) {
      await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
      await updateRecordFailed(recordId, 'AI 内容生成失败')
      return { index: 0, success: false, error: 'AI 内容生成失败' }
    }

    const vocabulary = aiResult.vocabulary!
    const questions = aiResult.questions!

    // 7. 标题处理
    let finalTitle: string
    if (title) {
      finalTitle = title
    } else {
      const titleResult = await generateTitle(textContent)
      if (titleResult.success && titleResult.title) {
        finalTitle = titleResult.title
      } else {
        logger.warn('[admin upload] 标题生成失败，降级为文本截取:', titleResult.error)
        finalTitle = fallbackTitle
      }
    }

    // 8. 入库（事务）
    const segmentId = await withTransaction(async (conn) => {
      const [segRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO segment (unit_id, title, textContent, translation, questions, is_public, media_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [unitId, finalTitle, textContent, aiResult.translation ?? '', JSON.stringify(questions), isPublic, segmentMediaId]
      )
      const newSegmentId = segRes.insertId

      let vocabIndex = 0
      for (const vocab of vocabulary) {
        let vocabMediaId: number | null = null
        const vocabTts = await textToSpeech(vocab.word)

        if (vocabTts.success && vocabTts.audio) {
          const vocabKey = `audio/vocab/${randomUUID()}.mp3`
          try {
            await uploadWithKey(vocabTts.audio, vocabKey)
          } catch {
            // 词汇音频上传失败不影响整体
          }

          const [vmRes] = await conn.execute<ResultSetHeader>(
            `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, mime_type, size_bytes, duration, status)
             VALUES (NULL, 'vocab_audio', 'oss', ?, ?, 'audio/mpeg', ?, 0, 1)`,
            [bucket, vocabKey, vocabTts.audio.length]
          )
          vocabMediaId = vmRes.insertId
        }

        await conn.execute(
          `INSERT INTO vocabulary (segment_id, word, forms, phonetic, meaning, exampleSentence, exampleTranslation, media_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newSegmentId, vocab.word, vocab.forms ?? null, vocab.phonetic ?? null, vocab.meaning,
            vocab.exampleSentence ?? null, vocab.exampleTranslation ?? null, vocabMediaId, vocabIndex++]
        )
      }

      return newSegmentId
    })

    // 9. 更新记录为成功
    await updateRecordSuccess(recordId, segmentId)
    if (finalTitle !== fallbackTitle) {
      await pool.execute('UPDATE material_upload_record SET title = ? WHERE id = ?', [finalTitle, recordId])
    }

    logger.info(`[admin upload] 成功 record=${recordId} segment=${segmentId} title=${finalTitle}`)
    return { index: 0, success: true, segmentId, title: finalTitle }
  } catch (err) {
    logger.error('[admin upload] 处理失败:', err)
    try { await updateRecordFailed(recordId, '处理失败') } catch { /* ignore */ }
    return { index: 0, success: false, error: '处理失败' }
  }
}

// ============ 批量处理 ============

export async function processAdminBatch(params: {
  userId: number
  unitId: number
  voice: string
  isPublic: number
  bucket: string
  files: Array<{ name: string, content: string }>
}): Promise<AdminUploadItemResult[]> {
  const { userId, unitId, voice, isPublic, bucket, files } = params
  const results: AdminUploadItemResult[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!
    const parsed = { title: null as string | null, textContent: '' }

    // 解析 txt
    try {
      const r = parseTxtFile(file.content)
      parsed.title = r.title
      parsed.textContent = r.textContent
    } catch {
      results.push({ index: i, success: false, error: `文件 ${file.name} 解析失败：内容为空` })
      continue
    }

    const result = await processAdminMaterial({
      userId, unitId,
      textContent: parsed.textContent,
      title: parsed.title,
      voice, isPublic, bucket,
    })
    results.push({ ...result, index: i })
  }

  return results
}