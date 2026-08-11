import { randomUUID } from 'node:crypto'
import { isDialogueText, parseTxtFile, extractInlineTitle } from '#server/utils/textParser'
import { generateLearningContent, generateTitle } from './aiContent'
import { ttsWithRetry } from './ttsRetry'
import { uploadWithKey, deleteObject, downloadObject } from '#server/utils/oss'
import { extractAudioMeta } from '#server/utils/audioMeta'
import { pool, withTransaction } from '#server/utils/db'
import { mapWithConcurrency } from '#server/utils/concurrency'
import { withQueue } from './serviceQueue'
import { isUploadQueueFull } from './materialJob'
import { getUploadLimits } from '#server/utils/uploadLimitChecker'
import { recognizeSpeech } from './sttFiletrans'
import { moderateText } from './contentModeration'
import { compareTextSimilarity } from '#server/utils/textSimilarity'
import { logger } from '#shared/utils/logger'
import { fileLog } from '#server/utils/fileLogger'
import type { AdminUploadItemResult } from '#shared/types/adminUpload'
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
  nlsCheck: number = 0,
  audioOssKey?: string | null,
): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO material_upload_record (user_id, title, text_content, voice, audio_oss_key, is_public, nls_check, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, title, textContent, voice, audioOssKey ?? null, isPublic, nlsCheck, status],
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
  /** 同步段已持久化到 OSS 的主音频 key（重处理复用）。来源优先级：audioBuffer > audioOssKey > TTS */
  audioOssKey?: string
  /** 传入时跳过 createUploadRecord，复用已有记录 ID */
  existingRecordId?: number
  /** 是否开启 NLS 语音校对（仅含音频时生效；消耗 NLS 额度，失败整单失败） */
  nlsCheck?: boolean
  /** 标题模式：'ai'（默认，title 为空时 AI 生成）| 'manual'（仅用传入 title）| 'filename'（由文件名定）| 'inline'（正文首个 `# ` 行） */
  titleMode?: 'ai' | 'manual' | 'filename' | 'inline'
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
    audioOssKey,
    nlsCheck = false,
    titleMode = 'ai',
  } = params

  // 1. 对话检测（免费正则）：仅无用户音频时拒绝——带音频时主音频不依赖 TTS 合成，允许对话文本
  if (!audioBuffer && !audioOssKey && isDialogueText(textContent)) {
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
        undefined,
        nlsCheck ? 1 : 0,
        audioOssKey,
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
    // 主音频来源优先级：同步段刚上传的 audioBuffer → 已持久化的 audioOssKey（重处理复用，需下载）→ TTS 合成。
    // 持久化路径（buffer/key）绝不 push 进 uploadedKeys：失败时保留对象供重处理复用，不重复上传。
    let audioBuffer_: Buffer
    let mediaType: string
    const ext = audioFileName ? audioFileName.split('.').pop()?.toLowerCase() || 'mp3' : 'mp3'
    // 持久化路径复用同步段已上传的 key；TTS 路径新建 key
    const ossKey = audioOssKey ?? `audio/material/${randomUUID()}.${ext}`

    if (audioBuffer) {
      // 同步段已上传 OSS：只做元数据校验与 NLS 校对，不再重复上传
      audioBuffer_ = audioBuffer
      mediaType = 'user_material'
    } else if (audioOssKey) {
      // 重处理复用：下载已持久化的主音频
      try {
        audioBuffer_ = await downloadObject(audioOssKey)
      } catch (err) {
        logger.error('[admin upload] 原音频下载失败:', err)
        await fail('原音频不可用，请重新上传含音频的材料')
        return { index: 0, success: false, error: '原音频不可用，请重新上传含音频的材料' }
      }
      mediaType = 'user_material'
    } else {
      // 无音频：TTS 生成（带自动重试）
      const ttsResult = await ttsWithRetry(textContent, voice)
      if (!ttsResult.success || !ttsResult.audio) {
        await fail('音频生成失败')
        return { index: 0, success: false, error: '音频生成失败' }
      }
      audioBuffer_ = ttsResult.audio
      mediaType = 'tts'

      // 3. OSS 上传（仅 TTS 路径：主音频 key 进入清理栈；持久化路径不重复上传）
      try {
        await uploadWithKey(audioBuffer_, ossKey)
        uploadedKeys.push(ossKey)
      } catch (err) {
        logger.error('[admin upload] OSS 上传失败:', err)
        await fail('文件上传失败')
        return { index: 0, success: false, error: '文件上传失败' }
      }
    }

    // 3.5 可选 NLS 语音校对（仅开启且本任务使用用户音频——同步 buffer 或持久化复用——时生效）：
    // 仿 materialJob 的 STT 链路——识别 → 音频文本审核 → 与材料文本相似度对比。
    // 消耗 NLS 额度（filetrans 每日 2h 免费 / flash 按量），任一失败整单失败并走清理栈。
    const hasUserAudio = Boolean(audioBuffer || audioOssKey)
    if (nlsCheck && hasUserAudio) {
      const sttFormat = ['wav', 'aac', 'opus', 'mp4'].includes(ext)
        ? (ext as 'wav' | 'aac' | 'opus' | 'mp4')
        : 'mp3'
      const sttResult = await recognizeSpeech({
        audioBuffer: audioBuffer_,
        format: sttFormat,
        ossKey,
      })
      if (!sttResult.success) {
        const msg = `音频识别失败: ${sttResult.error ?? '未知原因'}`
        await fail(msg)
        return { index: 0, success: false, error: '音频识别失败' }
      }
      const recognizedText = sttResult.text ?? ''
      if (recognizedText.trim()) {
        const mod2 = await moderateText(recognizedText)
        if (!mod2.safe) {
          const msg = `音频内容不合规: ${mod2.reason ?? '未知原因'}`
          await fail(msg)
          return { index: 0, success: false, error: '音频内容不合规' }
        }
        const sim = compareTextSimilarity(textContent, recognizedText)
        if (!sim.passed) {
          const msg = `音频内容与材料文本不匹配（相似度 ${(sim.score * 100).toFixed(0)}%）`
          await fail(msg)
          return { index: 0, success: false, error: '音频内容与材料文本不匹配' }
        }
      }
      logger.info(`[admin upload] NLS 校对通过 record=${recordId}`)
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

    // 6. AI 内容生成 + 标题生成（并行；仅 titleMode=ai 且无用户指定标题时生成标题）
    const needAiTitle = (titleMode ?? 'ai') === 'ai' && !title?.trim()
    const [aiResult, titleResult] = await Promise.all([
      generateLearningContent(textContent),
      needAiTitle ? generateTitle(textContent) : Promise.resolve(null),
    ])
    if (!aiResult.success || !aiResult.vocabulary || !aiResult.questions) {
      await fail('AI 内容生成失败')
      return { index: 0, success: false, error: 'AI 内容生成失败' }
    }

    const vocabulary = aiResult.vocabulary!
    const questions = aiResult.questions!

    // 7. 标题处理：title 优先 → AI 结果（仅 ai 模式）→ 文本截取降级
    let finalTitle: string
    if (title) {
      finalTitle = title
    } else if (needAiTitle && titleResult && titleResult.success && titleResult.title) {
      finalTitle = titleResult.title
    } else if (needAiTitle) {
      // AI 失败降级：截取前 50 字符（与 enqueue 阶段 fallbackTitle 同口径）
      logger.warn('[admin upload] 标题生成失败，降级为文本截取:', titleResult?.error)
      fileLog('ai', 'warn', '[admin upload] 标题生成失败，已截取文本前50字符为标题', {
        error: titleResult?.error,
        textLength: textContent.length,
      })
      finalTitle = fallbackTitle
    } else {
      // 非 ai 模式（manual/filename/inline）未提供标题：直接文本截取
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
        `INSERT INTO segment (unit_id, title, textContent, translation, questions, is_public, nls_check, media_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          unitId,
          finalTitle,
          textContent,
          aiResult.translation ?? '',
          JSON.stringify(questions),
          isPublic,
          nlsCheck && hasUserAudio ? 1 : 0,
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

  // 轻校验：拒绝时不产生记录（与同步时代行为一致）。入队阶段无 audioOssKey 概念，
  // 仅无音频 Buffer 时拒绝对话——带音频时主音频不依赖 TTS 合成，允许对话文本
  if (!params.audioBuffer && isDialogueText(textContent)) {
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
      params.nlsCheck ? 1 : 0,
      params.audioOssKey,
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
  titleMode?: 'ai' | 'manual' | 'filename' | 'inline'
}): Promise<AdminUploadItemResult[]> {
  const { userId, unitId, voice, isPublic, bucket, files, titleMode = 'ai' } = params
  const results: AdminUploadItemResult[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!

    // 解析 txt（空内容抛错走现有 catch → results.push 解析失败）
    let textContent: string
    try {
      textContent = parseTxtFile(file.content).textContent
    } catch {
      results.push({ index: i, success: false, error: `文件 ${file.name} 解析失败：内容为空` })
      continue
    }

    // 标题模式：inline 取正文首个 `# ` 行；filename 取文件名去扩展名（超 50 截取并提示）；
    // manual（批量不提供）与 ai → title=null（流水线 AI 生成）
    let title: string | null = null
    let notice: string | undefined
    if (titleMode === 'inline') {
      const inline = extractInlineTitle(textContent)
      title = inline.title
      textContent = inline.textContent // 用提取后的正文
    } else if (titleMode === 'filename') {
      const raw = file.name.replace(/\.[^.]+$/, '')
      if (raw.length > 50) {
        title = raw.slice(0, 50)
        notice = '标题超过 50 字符，已截取'
        fileLog('ai', 'warn', '[admin upload] 批量文件名标题超过50字符，已截取', {
          fileName: file.name,
          title,
        })
      } else {
        title = raw
      }
    }

    // 拆单入队：每个文件独立任务，可与用户任务交错调度，不再整块霸占队列
    const result = await enqueueAdminMaterial({
      userId,
      unitId,
      textContent,
      title,
      titleMode,
      voice,
      isPublic,
      bucket,
    })
    results.push({ ...result, index: i, notice })
  }

  return results
}
