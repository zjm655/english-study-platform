import { randomUUID } from 'node:crypto'
import { isDialogueText, parseTxtFile } from './textParser'
import { generateLearningContent, generateTitle } from './aiContent'
import { textToSpeech } from './tts'
import { ttsWithRetry } from './ttsRetry'
import { uploadWithKey, deleteObject } from './oss'
import { extractAudioMeta } from './audioMeta'
import { pool, withTransaction } from './db'
import { mapWithConcurrency } from './concurrency'
import { withQueue } from './serviceQueue'
import { isUploadQueueFull } from './materialJob'
import { getUploadLimits } from './uploadLimitChecker'
import { logger } from '../../shared/utils/logger'
import type { AdminUploadItemResult } from '../../shared/types/adminUpload'
import type { ResultSetHeader } from 'mysql2'

// 管理员音频时长/大小限制已抽入 sys_config 运营可调（见 uploadLimitChecker），使用处动态读取

// ============ 记录追踪 ============

async function createUploadRecord(
  userId: number,
  title: string,
  textContent: string,
  voice: string,
  isPublic: number,
  status: 'queued' | 'processing' = 'processing',
): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO material_upload_record (user_id, title, text_content, voice, is_public, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, title, textContent, voice, isPublic, status],
  )
  return res.insertId
}

async function updateRecordFailed(recordId: number, error: string) {
  await pool.execute(
    `UPDATE material_upload_record SET status = 'failed', error_message = ? WHERE id = ?`,
    [error.substring(0, 500), recordId],
  )
}

async function updateRecordSuccess(recordId: number, segmentId: number) {
  await pool.execute(
    `UPDATE material_upload_record SET status = 'success', segment_id = ? WHERE id = ?`,
    [segmentId, recordId],
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
  /** 传入时跳过 createUploadRecord，复用已有记录 ID */
  existingRecordId?: number
}

export async function processAdminMaterial(
  params: ProcessAdminMaterialParams,
): Promise<AdminUploadItemResult> {
  const {
    userId,
    unitId,
    textContent,
    title,
    voice,
    isPublic,
    bucket,
    audioBuffer,
    audioFileName,
  } = params

  // 1. 对话检测（免费正则）
  if (isDialogueText(textContent)) {
    return { index: 0, success: false, error: '材料为对话格式，不支持上传' }
  }

  const fallbackTitle = textContent.length > 50 ? textContent.slice(0, 50) + '...' : textContent
  let recordId: number

  if (params.existingRecordId) {
    recordId = params.existingRecordId
    try {
      await pool.execute(
        `UPDATE material_upload_record SET status = 'processing', error_message = NULL WHERE id = ?`,
        [recordId],
      )
    } catch (err) {
      logger.error('[admin upload] 重置记录状态失败:', err)
      return { index: 0, success: false, error: '重置记录状态失败' }
    }
  } else {
    try {
      recordId = await createUploadRecord(
        userId,
        title || fallbackTitle,
        textContent,
        voice,
        isPublic,
      )
    } catch (err) {
      logger.error('[admin upload] 创建记录失败:', err)
      return { index: 0, success: false, error: '创建上传记录失败' }
    }
  }

  // 清理栈：已上传的 OSS key（失败时统一 best-effort 删除）+ 主音频 media id（仿 materialJob）
  const uploadedKeys: string[] = []
  let segmentMediaId: number | null = null
  // 事务提交后置真：segment 已引用资源，此后任何写失败都不得走 fail()
  let committed = false
  let committedSegmentId = 0

  /** 失败收尾：标记 record + 禁用 media + 清理 OSS 孤儿 */
  async function fail(message: string): Promise<void> {
    try {
      if (segmentMediaId !== null) {
        await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
      }
      await updateRecordFailed(recordId, message)
    } catch (err) {
      logger.error('[admin upload] 失败状态写入异常:', err)
    }
    for (const key of uploadedKeys) {
      void deleteObject(key)
    }
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
        await fail('音频生成失败')
        return { index: 0, success: false, error: '音频生成失败' }
      }
      audioBuffer_ = ttsResult.audio
      mediaType = 'tts'
    }

    // 3. OSS 上传
    const ossKey = `audio/material/${randomUUID()}.${ext}`
    try {
      await uploadWithKey(audioBuffer_, ossKey)
      uploadedKeys.push(ossKey)
    } catch (err) {
      logger.error('[admin upload] OSS 上传失败:', err)
      await fail('文件上传失败')
      return { index: 0, success: false, error: '文件上传失败' }
    }

    // 4. 插入 media 记录
    const originalName = audioFileName || 'tts.mp3'
    const [mediaRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, size_bytes, status)
       VALUES (?, ?, 'oss', ?, ?, ?, ?, ?, 1)`,
      [userId, mediaType, bucket, ossKey, originalName, `audio/${ext}`, audioBuffer_.length],
    )
    segmentMediaId = mediaRes.insertId

    // 5. 音频元数据校验（限制值运营可调，取自 sys_config，5min 缓存）
    const limits = await getUploadLimits()
    const meta = await extractAudioMeta(audioBuffer_)
    if (!meta) {
      await fail('无法解析音频信息')
      return { index: 0, success: false, error: '无法解析音频信息' }
    }

    if (meta.duration > limits.maxAudioDurationAdmin) {
      await fail(`音频时长超限: ${meta.duration.toFixed(1)}s`)
      return { index: 0, success: false, error: `音频时长超限` }
    }
    if (meta.size > limits.maxAudioSizeAdmin) {
      await fail(`音频大小超限`)
      return { index: 0, success: false, error: '音频大小超限' }
    }

    await pool.execute('UPDATE media SET duration = ? WHERE id = ?', [
      meta.duration,
      segmentMediaId,
    ])

    // 6. AI 内容生成 + 标题生成（并行；标题仅在无用户指定标题时生成）
    const [aiResult, titleResult] = await Promise.all([
      generateLearningContent(textContent),
      title ? Promise.resolve(null) : generateTitle(textContent),
    ])
    if (!aiResult.success || !aiResult.vocabulary || !aiResult.questions) {
      await fail('AI 内容生成失败')
      return { index: 0, success: false, error: 'AI 内容生成失败' }
    }

    const vocabulary = aiResult.vocabulary!
    const questions = aiResult.questions!

    // 7. 标题处理
    let finalTitle: string
    if (title) {
      finalTitle = title
    } else if (titleResult && titleResult.success && titleResult.title) {
      finalTitle = titleResult.title
    } else {
      logger.warn('[admin upload] 标题生成失败，降级为文本截取:', titleResult?.error)
      finalTitle = fallbackTitle
    }

    // 8. 词汇音频（TTS + OSS）——事务外受限并发预生成
    // 绝不放在事务内：TTS(WebSocket) 与 OSS 上传是耗时网络 I/O，会长时间占用连接池连接。
    // 词汇音频失败（TTS 或 OSS 任一失败）则 media=null，不影响整体入库。
    const vocabAudios = await mapWithConcurrency(vocabulary, 4, async (vocab) => {
      // 词汇发音走带重试版：失败会被静默跳过（该词永久无发音），瞬时性故障值得重试
      const vocabTts = await ttsWithRetry(vocab.word)
      if (!vocabTts.success || !vocabTts.audio) return { vocab, media: null }
      const vocabKey = `audio/vocab/${randomUUID()}.mp3`
      try {
        await uploadWithKey(vocabTts.audio, vocabKey)
        uploadedKeys.push(vocabKey)
      } catch {
        // 词汇音频上传失败不影响整体
        return { vocab, media: null }
      }
      return { vocab, media: { key: vocabKey, size: vocabTts.audio.length } }
    })

    // 9. 全部入库（短事务，仅纯 DB 写，不含任何网络 I/O）
    const segmentId = await withTransaction(async (conn) => {
      const [segRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO segment (unit_id, title, textContent, translation, questions, is_public, media_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          unitId,
          finalTitle,
          textContent,
          aiResult.translation ?? '',
          JSON.stringify(questions),
          isPublic,
          segmentMediaId,
        ],
      )
      const newSegmentId = segRes.insertId

      let vocabIndex = 0
      for (const { vocab, media } of vocabAudios) {
        let vocabMediaId: number | null = null
        if (media) {
          const [vmRes] = await conn.execute<ResultSetHeader>(
            `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, mime_type, size_bytes, duration, status)
             VALUES (NULL, 'vocab_audio', 'oss', ?, ?, 'audio/mpeg', ?, 0, 1)`,
            [bucket, media.key, media.size],
          )
          vocabMediaId = vmRes.insertId
        }

        await conn.execute(
          `INSERT INTO vocabulary (segment_id, word, forms, phonetic, meaning, exampleSentence, exampleTranslation, media_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newSegmentId,
            vocab.word,
            vocab.forms ?? null,
            vocab.phonetic ?? null,
            vocab.meaning,
            vocab.exampleSentence ?? null,
            vocab.exampleTranslation ?? null,
            vocabMediaId,
            vocabIndex++,
          ],
        )
      }

      return newSegmentId
    })

    // 9. 更新记录为成功（提交后 OSS 对象归业务所有，不再由清理栈管理）
    committed = true
    committedSegmentId = segmentId
    uploadedKeys.length = 0
    await updateRecordSuccess(recordId, segmentId)
    if (finalTitle !== fallbackTitle) {
      await pool.execute('UPDATE material_upload_record SET title = ? WHERE id = ?', [
        finalTitle,
        recordId,
      ])
    }

    logger.info(`[admin upload] 成功 record=${recordId} segment=${segmentId} title=${finalTitle}`)
    return { index: 0, success: true, segmentId, title: finalTitle }
  } catch (err) {
    logger.error('[admin upload] 处理失败:', err)
    if (committed) {
      // 提交后仅剩记录状态写失败：重试一次 success 补写，绝不误伤已入库的 segment/media/OSS
      await updateRecordSuccess(recordId, committedSegmentId).catch((e) =>
        logger.error('[admin upload] 提交后 success 状态补写失败:', e),
      )
      return {
        index: 0,
        success: true,
        segmentId: committedSegmentId,
        title: title || fallbackTitle,
      }
    }
    await fail('处理失败')
    return { index: 0, success: false, error: '处理失败' }
  }
}

// ============ 异步入队封装 ============

/**
 * 把单个材料任务入 upload 队列（管理员低优先级）：
 * 同步段仅做对话检测（免费正则，拒绝时不建记录）+ 建 queued 记录；
 * 完整流水线由 processAdminMaterial(existingRecordId) 在队列内执行（其内部含终态写入与 catch-all）。
 */
export async function enqueueAdminMaterial(
  params: Omit<ProcessAdminMaterialParams, 'existingRecordId'>,
): Promise<AdminUploadItemResult & { recordId?: number }> {
  const { userId, textContent, title, voice, isPublic } = params

  // 轻校验：拒绝时不产生记录（与同步时代行为一致）
  if (isDialogueText(textContent)) {
    return { index: 0, success: false, error: '材料为对话格式，不支持上传' }
  }

  // 入队深度防御（与用户端同口径）：防止管理员批量反复提交堆积内存 Buffer
  try {
    if (await isUploadQueueFull()) {
      return { index: 0, success: false, error: '队列已满，请稍后再试' }
    }
  } catch (err) {
    logger.error('[admin upload] 队列深度检查失败:', err)
    return { index: 0, success: false, error: '队列状态检查失败，请重试' }
  }

  const fallbackTitle = textContent.length > 50 ? textContent.slice(0, 50) + '...' : textContent
  let recordId: number
  try {
    recordId = await createUploadRecord(
      userId,
      title || fallbackTitle,
      textContent,
      voice,
      isPublic,
      'queued',
    )
  } catch (err) {
    logger.error('[admin upload] 创建记录失败:', err)
    return { index: 0, success: false, error: '创建上传记录失败' }
  }

  // fire-and-forget 入队：管理员批量任务低优先级（0 < 用户交互任务的 1）
  withQueue('upload', () => processAdminMaterial({ ...params, existingRecordId: recordId }), {
    priority: 0,
  }).catch(async (err) => {
    logger.error('[admin upload] 任务入队执行异常:', err)
    await updateRecordFailed(recordId, '任务调度异常，请重试').catch(() => {})
  })

  return { index: 0, success: true, recordId, title: title || fallbackTitle }
}

// ============ 批量处理（已改为拆单入队，不再串行执行流水线） ============

export async function processAdminBatch(params: {
  userId: number
  unitId: number
  voice: string
  isPublic: number
  bucket: string
  files: Array<{ name: string; content: string }>
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

    // 拆单入队：每个文件独立任务，可与用户任务交错调度，不再整块霸占队列
    const result = await enqueueAdminMaterial({
      userId,
      unitId,
      textContent: parsed.textContent,
      title: parsed.title,
      voice,
      isPublic,
      bucket,
    })
    results.push({ ...result, index: i })
  }

  return results
}
