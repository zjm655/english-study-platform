// server/services/materialJob.ts
// 材料上传异步任务体：从 segment/upload.post.ts 的同步 handler 中抽出的完整流水线。
//
// 设计约定：
// - 本函数在 upload 队列（serviceQueue）内 fire-and-forget 执行，与 HTTP 生命周期完全解耦：
//   入参只持有拷贝数据（audioBuffer/userId 等），绝不触碰 event。
// - 整体 try/catch 永不外抛——fire-and-forget 下 unhandled rejection 会崩掉进程；
//   任何失败路径都落 material_upload_record.status='failed'（record 是任务唯一真相源）。
// - 清理栈：每步 OSS 上传成功即登记 key，失败时统一 best-effort 清理，避免孤儿文件
//  （比原同步版更完备：原版仅事务失败分支清理，meta/AI 失败时主音频会成为孤儿）。
// - 内部云调用（moderate/STT/TTS/AI）经各自云产品队列限流（提交 1 已包裹），本函数无需重复关心。
import { randomUUID } from 'node:crypto'
import type { ResultSetHeader } from 'mysql2'
import { moderateText } from './contentModeration'
import { recognizeSpeech } from './sttFiletrans'
import { compareTextSimilarity } from '#server/utils/textSimilarity'
import { extractAudioMeta } from '#server/utils/audioMeta'
import { generateLearningContent, generateTitle } from './aiContent'
import { ttsWithRetry } from './ttsRetry'
import { uploadWithKey, deleteObject, downloadObject } from '#server/utils/oss'
import { fileLog } from '#server/utils/fileLogger'
import { withTransaction, pool } from '#server/utils/db'
import { mapWithConcurrency } from '#server/utils/concurrency'
import { getUploadLimits } from '#server/utils/uploadLimitChecker'

// 音频时长/大小限制已抽入 sys_config 运营可调（见 uploadLimitChecker），
// 上传 handler 入队前的前置校验与本流水线内的后置兼校统一走 getUploadLimits()。

// ============ 入队深度防御（用户/管理员入队共用） ============
/** 排队任务超过 upload_queue_max 配置直接拒绝，防止极端情况下内存中堆积过多音频 Buffer */
export async function isUploadQueueFull(): Promise<boolean> {
  const { uploadQueueMax } = await getUploadLimits()
  const [rows] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM material_upload_record WHERE status = 'queued'`,
  )
  const cnt = (rows as Array<{ cnt: number | string }>)[0]?.cnt ?? 0
  return Number(cnt) >= uploadQueueMax
}

// ============ 记录辅助（供 handler 与本任务共用） ============

export async function createUploadRecord(
  userId: number,
  title: string,
  textContent: string,
  voice: string,
  isPublic: number,
  status: 'queued' | 'processing' = 'queued',
  audioOssKey?: string | null,
): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO material_upload_record (user_id, title, text_content, voice, audio_oss_key, is_public, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, title, textContent, voice, audioOssKey ?? null, isPublic, status],
  )
  return res.insertId
}

export async function updateRecordFailed(recordId: number, error: string): Promise<void> {
  await pool.execute(
    `UPDATE material_upload_record SET status = 'failed', error_message = ? WHERE id = ?`,
    [error.substring(0, 500), recordId],
  )
}

export async function updateRecordSuccess(recordId: number, segmentId: number): Promise<void> {
  await pool.execute(
    `UPDATE material_upload_record SET status = 'success', segment_id = ? WHERE id = ?`,
    [segmentId, recordId],
  )
}

// ============ 任务入参 ============

export interface MaterialJobParams {
  recordId: number
  userId: number
  /** 管理员档：更长时长上限、可指定单元 */
  isAdmin: boolean
  textContent: string
  voice: string
  isPublic: number
  unitId: number
  /** 同步段按 titleMode 已确定的标题；null/空=需 AI 生成 */
  title?: string | null
  /** 用户上传的音频（无则走 TTS 合成） */
  audioBuffer?: Buffer
  audioFileName?: string
  /** 同步段已持久化到 OSS 的主音频 key（重处理复用）。来源优先级：audioBuffer > audioOssKey > TTS */
  audioOssKey?: string
}

function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || 'mp3'
}

function extToFormat(filename: string): 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4' {
  const ext = getExt(filename)
  if (['wav', 'aac', 'opus', 'mp4'].includes(ext))
    return ext as 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4'
  return 'mp3'
}

/**
 * 执行材料上传流水线（在 upload 队列内调用）。
 * 永不抛出；所有终态（success/failed）写入 material_upload_record。
 */
export async function runMaterialJob(params: MaterialJobParams): Promise<void> {
  const { recordId, userId, isAdmin, textContent, voice, isPublic, unitId } = params

  // 清理栈：已上传的 OSS key（失败时统一 best-effort 删除）+ 主音频 media id
  const uploadedKeys: string[] = []
  let segmentMediaId: number | null = null
  // 事务提交后置真：segment 已引用资源，此后任何写失败都不得走 fail()（禁 media/删 OSS/翻转 failed）
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
      logger.error('[material job] 失败状态写入异常:', err)
    }
    for (const key of uploadedKeys) {
      void deleteObject(key)
    }
  }

  try {
    // 标记进入执行态（queued → processing）
    await pool.execute(`UPDATE material_upload_record SET status = 'processing' WHERE id = ?`, [
      recordId,
    ])

    logger.info(
      `[material job] 开始处理 user=${userId} record=${recordId} ${
        params.audioBuffer ? '用户上传音频' : params.audioOssKey ? '持久化音频复用' : 'TTS合成'
      } 文本${textContent.length}字`,
    )

    // ===== Step 1: 文本审核 =====
    // 带音频时主音频不依赖 TTS，允许对话文本（对话限制本为无音频时 TTS 无法区分多角色而设）
    const mod1 = await moderateText(textContent, {
      allowDialogue: Boolean(params.audioBuffer?.length || params.audioOssKey),
    })
    if (!mod1.safe) {
      return await fail(`材料内容不合规: ${mod1.reason}`)
    }

    // ===== Step 2: 音频处理 =====
    // 主音频来源优先级：同步段刚上传的 audioBuffer → 已持久化的 audioOssKey（重处理复用，需下载）→ TTS 合成。
    // 持久化路径（buffer/key）绝不 push 进 uploadedKeys：同步段已上传、失败时保留对象供重处理复用，不重复上传。
    let audioBuffer: Buffer
    let mediaType: string
    let audioDuration = 0
    const ext = params.audioFileName ? getExt(params.audioFileName) : 'mp3'
    // 持久化路径复用同步段已上传的 key；TTS 路径新建 key
    const ossKey = params.audioOssKey ?? `audio/material/${randomUUID()}.${ext}`
    const bucket = useRuntimeConfig().oss.bucket
    // 限制值运营可调（sys_config），5min 缓存内不额外查库
    const limits = await getUploadLimits()
    const maxDuration = isAdmin ? limits.maxAudioDurationAdmin : limits.maxAudioDurationUser
    const maxSize = isAdmin ? limits.maxAudioSizeAdmin : limits.maxAudioSizeUser

    /** 元数据校验：返回错误文案（null=通过），并记录时长供 media 入库 */
    const checkAudioMeta = async (buf: Buffer): Promise<string | null> => {
      const meta = await extractAudioMeta(buf)
      if (!meta) return '无法解析音频信息'
      if (meta.duration > maxDuration) {
        return `音频时长 ${meta.duration.toFixed(1)}s 超过限制（${maxDuration}s）`
      }
      if (meta.size > maxSize) {
        return `音频大小 ${(meta.size / 1024 / 1024).toFixed(1)}MB 超过限制`
      }
      audioDuration = meta.duration
      return null
    }

    /** 主音频上传（成功即登记清理栈，后续任何失败统一由 fail() 删除）——仅 TTS 路径调用 */
    const uploadMainAudio = async (buf: Buffer): Promise<boolean> => {
      try {
        await uploadWithKey(buf, ossKey)
        uploadedKeys.push(ossKey)
        return true
      } catch (err) {
        logger.error('[material job] OSS 上传失败:', err)
        return false
      }
    }

    /** 用户音频链路 STT → 音频文本审核 → 文本相似度（原 2c-2e；持久化两条路径共用）。返回错误文案（null=通过） */
    const runSttChain = async (buf: Buffer): Promise<string | null> => {
      const sttResult = await recognizeSpeech({
        audioBuffer: buf,
        format: extToFormat(params.audioFileName ?? ''),
        ossKey,
      })
      if (!sttResult.success) {
        return `音频识别失败: ${sttResult.error}`
      }
      const recognizedText = sttResult.text ?? ''
      if (recognizedText.trim()) {
        const mod2 = await moderateText(recognizedText)
        if (!mod2.safe) {
          return `音频内容不合规: ${mod2.reason}`
        }
        const sim = compareTextSimilarity(textContent, recognizedText)
        if (!sim.passed) {
          return `音频内容与材料文本不匹配（相似度 ${(sim.score * 100).toFixed(0)}%）`
        }
      }
      return null
    }

    if (params.audioBuffer && params.audioBuffer.length > 0) {
      // 2a. 同步段已上传 OSS：只做元数据校验与 STT，不再重复上传
      audioBuffer = params.audioBuffer
      mediaType = 'user_material'

      const metaErr = await checkAudioMeta(audioBuffer)
      if (metaErr) return await fail(metaErr)

      const sttErr = await runSttChain(audioBuffer)
      if (sttErr) return await fail(sttErr)
    } else if (params.audioOssKey) {
      // 2b. 重处理复用：下载已持久化的主音频（audioFileName 缺失，STT format 经 extToFormat 兜底 mp3）
      try {
        audioBuffer = await downloadObject(params.audioOssKey)
      } catch (err) {
        logger.error('[material job] 原音频下载失败:', err)
        return await fail('原音频不可用，请重新上传含音频的材料')
      }
      mediaType = 'user_material'

      const metaErr = await checkAudioMeta(audioBuffer)
      if (metaErr) return await fail(metaErr)

      const sttErr = await runSttChain(audioBuffer)
      if (sttErr) return await fail(sttErr)
    } else {
      // 2c. 无音频：TTS 生成（带自动重试；合成后同样校验元数据再上传）
      const ttsResult = await ttsWithRetry(textContent, voice)
      if (!ttsResult.success || !ttsResult.audio) {
        return await fail(`音频生成失败: ${ttsResult.error ?? '未知原因'}`)
      }
      audioBuffer = ttsResult.audio
      mediaType = 'tts'

      const metaErr = await checkAudioMeta(audioBuffer)
      if (metaErr) return await fail(metaErr)

      if (!(await uploadMainAudio(audioBuffer))) {
        return await fail('文件上传失败')
      }
    }

    // 2g. 插入 media 记录（duration 已在元数据校验时取得，直接入库）
    const originalName = params.audioFileName ?? 'tts.mp3'
    const [mediaRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, size_bytes, duration, status)
     VALUES (?, ?, 'oss', ?, ?, ?, ?, ?, ?, 1)`,
      [
        userId,
        mediaType,
        bucket,
        ossKey,
        originalName,
        `audio/${ext}`,
        audioBuffer.length,
        audioDuration,
      ],
    )
    segmentMediaId = mediaRes.insertId

    // ===== Step 4: AI 内容生成 + 标题生成（并行） =====
    // 同步段按 titleMode 已确定的标题直接透传（params.title 非空时不再调 AI 标题生成）
    const presetTitle = (params.title ?? '').trim()
    const [aiResult, titleResult] = await Promise.all([
      generateLearningContent(textContent),
      presetTitle ? Promise.resolve(null) : generateTitle(textContent),
    ])
    if (!aiResult.success || !aiResult.vocabulary || !aiResult.questions) {
      return await fail('AI 内容生成失败')
    }

    const vocabulary: NonNullable<typeof aiResult.vocabulary> = aiResult.vocabulary
    const questions: NonNullable<typeof aiResult.questions> = aiResult.questions

    const fallbackTitle = textContent.length > 50 ? textContent.slice(0, 50) + '...' : textContent
    let title: string
    if (presetTitle) {
      title = presetTitle
    } else if (titleResult?.success && titleResult.title) {
      title = titleResult.title
    } else {
      logger.warn('[material job] 标题生成失败，降级为文本截取:', titleResult?.error)
      fileLog('ai', 'warn', '[material job] 标题生成失败，已截取文本前50字符为标题', {
        error: titleResult?.error,
        textLength: textContent.length,
      })
      title = fallbackTitle
    }

    // ===== Step 5: 词汇音频（TTS + OSS）——事务外受限并发预生成 =====
    // TTS/OSS 为耗时网络 I/O，绝不放事务内；词汇音频失败则 media=null 静默跳过
    const vocabAudios = await mapWithConcurrency(vocabulary, 4, async (vocab) => {
      const vocabTts = await ttsWithRetry(vocab.word)
      if (!vocabTts.success || !vocabTts.audio) return { vocab, media: null }
      const vocabKey = `audio/vocab/${randomUUID()}.mp3`
      try {
        await uploadWithKey(vocabTts.audio, vocabKey)
        uploadedKeys.push(vocabKey)
      } catch {
        return { vocab, media: null }
      }
      return { vocab, media: { key: vocabKey, size: vocabTts.audio.length } }
    })

    // ===== Step 6: 全部入库（短事务，仅纯 DB 写） =====
    let segmentId: number
    try {
      segmentId = await withTransaction(async (conn) => {
        const [segRes] = await conn.execute<ResultSetHeader>(
          `INSERT INTO segment (unit_id, title, textContent, translation, questions, is_public, media_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            unitId,
            title,
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
    } catch (err) {
      logger.error('[material job] 事务失败:', err)
      return await fail('入库失败')
    }

    // 成功收尾：入库完成后 OSS 对象归业务所有，不再由清理栈管理
    committed = true
    committedSegmentId = segmentId
    uploadedKeys.length = 0
    await updateRecordSuccess(recordId, segmentId)
    if (title !== fallbackTitle) {
      await pool.execute('UPDATE material_upload_record SET title = ? WHERE id = ?', [
        title,
        recordId,
      ])
    }

    logger.info(`[material job] 处理成功 record=${recordId} segment=${segmentId} title=${title}`)
  } catch (err) {
    // catch-all 兜底：绝不向 fire-and-forget 调用方抛出（unhandled rejection 会崩进程）
    logger.error('[material job] 未预期异常:', err)
    if (committed) {
      // 提交后仅剩记录状态写失败：重试一次 success 补写，绝不误伤已入库的 segment/media/OSS
      await updateRecordSuccess(recordId, committedSegmentId).catch((e) =>
        logger.error('[material job] 提交后 success 状态补写失败:', e),
      )
      return
    }
    await fail('处理失败，请重试或联系管理员')
  }
}
