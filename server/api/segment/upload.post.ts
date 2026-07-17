import { randomUUID } from 'node:crypto'
import { moderateText } from '#server/utils/contentModeration'
import { speechToText } from '#server/utils/speechToText'
import { compareTextSimilarity } from '#server/utils/textSimilarity'
import { extractAudioMeta } from '#server/utils/audioMeta'
import { generateLearningContent, generateTitle } from '#server/utils/aiContent'
import { textToSpeech } from '#server/utils/tts'
import { uploadWithKey } from '#server/utils/oss'
import { withTransaction, pool } from '#server/utils/db'
import { validateError, validateSuccess, uploadMaterialSchema, uploadMaterialAdminSchema } from '#server/utils/validate'
import type { UploadMaterialResult } from '#shared/types/material'
import type { ResultSetHeader } from 'mysql2'

// ============ 音频限制 ============
const USER_MAX_DURATION = 180    // 3 分钟
const ADMIN_MAX_DURATION = 600   // 10 分钟
const USER_MAX_SIZE = 2 * 1024 * 1024    // 2MB
const ADMIN_MAX_SIZE = 5 * 1024 * 1024   // 5MB

// ============ 辅助函数 ============

function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || 'mp3'
}

function extToFormat(filename: string): 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4' {
  const ext = getExt(filename)
  if (['wav', 'aac', 'opus', 'mp4'].includes(ext)) return ext as 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4'
  return 'mp3'
}

/**
 * 上传自定义材料
 * 请求：POST /api/segment/upload (multipart/form-data)
 */
export default defineEventHandler(async (event): Promise<ResPayload<UploadMaterialResult | null>> => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  // 1. 解析表单
  const formData = await readFormData(event)
  const textContent = formData.get('textContent') as string | null
  const voice = (formData.get('voice') as string | null) || 'en-US-AriaNeural'
  const isPublic = Number(formData.get('isPublic'))
  const unitIdRaw = formData.get('unitId') as string | null
  const audioFile = formData.get('audio') as File | null

  // 2. 角色判断
  const isAdmin = user.role === 1
  const finalUnitId = isAdmin && unitIdRaw ? Number(unitIdRaw) : 0

  // 3. Zod 校验
  const schema = isAdmin ? uploadMaterialAdminSchema : uploadMaterialSchema
  const parseInput: Record<string, unknown> = { textContent, isPublic, voice }
  if (isAdmin) parseInput.unitId = finalUnitId

  const parsed = schema.safeParse(parseInput)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message || '参数校验失败')
  }

  if (!textContent) return validateError('材料文本不能为空')

  // ===== Step 1: 文本审核 =====
  const mod1 = await moderateText(textContent)
  if (!mod1.safe) {
    return validateError(`材料内容不合规: ${mod1.reason}`)
  }

  // ===== Step 2: 音频处理 =====
  let audioBuffer: Buffer
  let mediaType: string

  if (audioFile && audioFile instanceof File && audioFile.size > 0) {
    // 2a. 读取音频 buffer
    audioBuffer = Buffer.from(await audioFile.arrayBuffer())
    mediaType = 'user_material'

    // 2b. 语音转文字
    const sttResult = await speechToText(audioBuffer, extToFormat(audioFile.name))
    if (!sttResult.success) {
      return validateError(`音频识别失败: ${sttResult.error}`)
    }

    // 2c. 音频文本审核
    const recognizedText = sttResult.text ?? ''
    if (recognizedText.trim()) {
      const mod2 = await moderateText(recognizedText)
      if (!mod2.safe) {
        return validateError(`音频内容不合规: ${mod2.reason}`)
      }

      // 2d. 文本相似度对比
      const sim = compareTextSimilarity(textContent, recognizedText)
      if (!sim.passed) {
        return validateError(`音频内容与材料文本不匹配（相似度 ${(sim.score * 100).toFixed(0)}%）`)
      }
    }
  } else {
    // 2e. 无音频：TTS 生成
    const ttsResult = await textToSpeech(textContent, voice)
    if (!ttsResult.success || !ttsResult.audio) {
      return validateError('音频生成失败，请稍后重试')
    }
    audioBuffer = ttsResult.audio
    mediaType = 'tts'
  }

  // 2f. 上传音频到 OSS
  const ext = audioFile && audioFile instanceof File ? getExt(audioFile.name) : 'mp3'
  const ossKey = `audio/material/${randomUUID()}.${ext}`
  const bucket = useRuntimeConfig().oss.bucket

  try {
    await uploadWithKey(audioBuffer, ossKey)
  } catch (err) {
    console.error('[material upload] OSS 上传失败:', err)
    return validateError('文件上传失败，请稍后重试', 500)
  }

  // 2g. 插入 media 记录
  const originalName = audioFile && audioFile instanceof File ? audioFile.name : 'tts.mp3'
  const [mediaRes] = await pool.execute<ResultSetHeader>(
    `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, size_bytes, status)
     VALUES (?, ?, 'oss', ?, ?, ?, ?, ?, 1)`,
    [user.id, mediaType, bucket, ossKey, originalName, `audio/${ext}`, audioBuffer.length]
  )
  const segmentMediaId = mediaRes.insertId

  // ===== Step 3: 音频元数据校验 =====
  const meta = await extractAudioMeta(audioBuffer)
  if (!meta) {
    await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
    return validateError('无法解析音频信息')
  }

  const maxDuration = isAdmin ? ADMIN_MAX_DURATION : USER_MAX_DURATION
  const maxSize = isAdmin ? ADMIN_MAX_SIZE : USER_MAX_SIZE

  if (meta.duration > maxDuration) {
    await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
    return validateError(`音频时长 ${meta.duration.toFixed(1)}s 超过限制（${maxDuration}s）`)
  }
  if (meta.size > maxSize) {
    await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
    return validateError(`音频大小 ${(meta.size / 1024 / 1024).toFixed(1)}MB 超过限制`)
  }

  // 更新 media 的 duration
  await pool.execute('UPDATE media SET duration = ? WHERE id = ?', [meta.duration, segmentMediaId])

  // ===== Step 4: AI 内容生成 =====
  const aiResult = await generateLearningContent(textContent)
  if (!aiResult.success || !aiResult.vocabulary || !aiResult.questions) {
    await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
    return validateError('AI 内容生成失败，请稍后重试')
  }

  // 窄化类型（上面已检查非空，但 TS 在闭包中无法追踪）
  const vocabulary: NonNullable<typeof aiResult.vocabulary> = aiResult.vocabulary
  const questions: NonNullable<typeof aiResult.questions> = aiResult.questions

  // ===== Step 5: 词汇 TTS + 全部入库（事务） =====
  const titleResult = await generateTitle(textContent)
  let title: string
  if (titleResult.success && titleResult.title) {
    title = titleResult.title
  } else {
    console.warn('[material upload] 标题生成失败，降级为文本截取:', titleResult.error)
    title = textContent.length > 50 ? textContent.slice(0, 50) + '...' : textContent
  }

  let segmentId: number
  try {
    segmentId = await withTransaction(async (conn) => {
      // 5a. 插入 segment
      const [segRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO segment (unit_id, title, textContent, translation, questions, is_public, media_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [finalUnitId, title, textContent, aiResult.translation ?? '', JSON.stringify(questions), isPublic, segmentMediaId]
      )
      const newSegmentId = segRes.insertId

      // 5b. 插入 vocabulary + 词汇音频
      let vocabIndex = 0
      for (const vocab of vocabulary) {

        // TTS 生成词汇音频
        let vocabMediaId: number | null = null
        const vocabTts = await textToSpeech(vocab.word)

        if (vocabTts.success && vocabTts.audio) {
          const vocabKey = `audio/vocab/${randomUUID()}.mp3`
          try {
            await uploadWithKey(vocabTts.audio, vocabKey)
          } catch {
            // 词汇音频上传失败不影响整体，跳过
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
  } catch (err) {
    console.error('[material upload] 事务失败:', err)
    await pool.execute('UPDATE media SET status = 0 WHERE id = ?', [segmentMediaId])
    return validateError('入库失败，请稍后重试', 500)
  }

  return validateSuccess<UploadMaterialResult>({ segmentId, title }, '材料上传成功')
})