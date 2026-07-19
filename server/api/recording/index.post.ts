import { randomUUID } from 'node:crypto'
import { withTransaction, pool } from '#server/utils/db'
import { uploadWithKey } from '#server/utils/oss'
import { validateError, validateSuccess, uploadRecordingSchema } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import { signUrl, RECORDING_EXPIRE } from '#server/utils/oss'
import { speechToText } from '#server/utils/speechToText'
import type { RecordingRow } from '#server/types/db'
import type { UploadRecordingResult } from '#shared/types/recording'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'

// ============ 安全配置 ============
const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50MB

// MIME → speechToText 格式映射
const MIME_TO_STT_FORMAT: Record<string, string> = {
  'audio/webm':  'opus',
  'audio/ogg':   'opus',
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
  'audio/mp3':   'mp3',
  'audio/mpeg':  'mp3',
}

// MIME 白名单 + 对应魔数签名（前 N 字节）
const AUDIO_SIGNATURES: Record<string, number[]> = {
  'audio/webm':  [0x1A, 0x45, 0xDF, 0xA3],  // EBML
  'audio/ogg':   [0x4F, 0x67, 0x67, 0x53],  // OggS
  'audio/wav':   [0x52, 0x49, 0x46, 0x46],  // RIFF
  'audio/x-wav': [0x52, 0x49, 0x46, 0x46],  // RIFF
}
// mp3/mpeg 允许两种魔数：ID3v2 标签或帧同步
const MP3_SIGNATURES = [
  [0x49, 0x44, 0x33],           // "ID3"
  [0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2],  // 帧同步
]

/**
 * 上传录音
 * 请求：POST /api/recording (multipart/form-data)
 */
export default defineEventHandler(async (event): Promise<ResPayload<UploadRecordingResult | null>> => {
  const userId = event.context.user?.id
  if (!userId) return validateError('未登录', 401)

  // 1. 解析 multipart/form-data
  const formData = await readFormData(event)
  const file = formData.get('audio')
  const segmentId = Number(formData.get('segmentId'))
  const phase = Number(formData.get('phase'))
  const duration = Number(formData.get('duration'))

  // 2. 基础数值校验（提前拦截 NaN）
  if (isNaN(segmentId) || isNaN(phase) || isNaN(duration)) {
    return validateError('参数格式错误', 400)
  }

  // 3. 文件存在性校验
  if (!file || !(file instanceof File)) {
    return validateError('未上传录音文件')
  }

  // 4. 文件大小二次校验
  if (file.size === 0) return validateError('文件为空')
  if (file.size > MAX_FILE_SIZE) return validateError('文件大小超过限制(50MB)')

  // 5. MIME 类型白名单校验
  const mimeType = file.type
  const allowedMimes = [...Object.keys(AUDIO_SIGNATURES), 'audio/mp3', 'audio/mpeg']
  if (!allowedMimes.includes(mimeType)) {
    return validateError('不支持的音频格式')
  }

  // 6. 魔数校验（防伪造 MIME）
  const fileBuffer = Buffer.from(await file.arrayBuffer())
  if (!verifyMagicBytes(fileBuffer, mimeType)) {
    return validateError('文件内容与声明类型不匹配')
  }

  // 7. Zod 校验业务字段
  const parseResult = uploadRecordingSchema.safeParse({ segmentId, phase, duration })
  if (!parseResult.success) {
    return validateError(parseResult.error.issues[0]?.message || '参数校验失败')
  }

  // 8. 上传到 OSS
  const ext = mimeType === 'audio/webm' ? 'webm'
    : mimeType === 'audio/ogg' ? 'ogg'
    : mimeType === 'audio/wav' || mimeType === 'audio/x-wav' ? 'wav'
    : 'mp3'
  const ossKey = `audio/recordings/${randomUUID()}.${ext}`

  try {
    await uploadWithKey(fileBuffer, ossKey)
  } catch (err) {
    logger.error('[recording upload] OSS 上传失败:', err)
    return validateError('文件上传失败，请稍后重试', 500)
  }

  // 9. 写入 media 表 + recording 表（事务）
  let result: UploadRecordingResult | null = null

  try {
    result = await withTransaction(async (conn) => {
      // 9a. 插入 media 表
      const [mediaRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO media (uploader_id, type, storage_type, bucket, object_key, original_name, mime_type, size_bytes, duration, status)
         VALUES (?, 'recording', 'oss', ?, ?, ?, ?, ?, ?, 1)`,
        [
          userId,
          useRuntimeConfig().oss.bucket,
          ossKey,
          `${randomUUID()}.${ext}`,
          mimeType,
          file.size,
          duration,
        ]
      )
      const mediaId = mediaRes.insertId

      // 9b. 插入 recording 表（关联 media_id）
      const [recRes] = await conn.execute<ResultSetHeader>(
        'INSERT INTO recording (user_id, segment_id, phase, media_id, duration) VALUES (?, ?, ?, ?, ?)',
        [userId, segmentId, phase, mediaId, duration]
      )

      // 9c. 查回完整记录
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT r.*, m.object_key AS rec_media_key
         FROM recording r
         LEFT JOIN media m ON r.media_id = m.id
         WHERE r.id = ? AND r.deleted_at IS NULL`,
        [recRes.insertId]
      )
      const row = rows[0] as (RecordingRow & { rec_media_key: string })

      // 9d. 签名返回
      const signedUrl = await signUrl(row.rec_media_key, RECORDING_EXPIRE)

      return {
        id: row.id,
        audioPath: signedUrl,
        duration: Number(row.duration),
        createdAt: row.createdAt,
      } satisfies UploadRecordingResult
    })
  } catch (err) {
    logger.error('[recording upload] 事务失败:', err)
    return validateError('上传失败，请稍后重试', 500)
  }

  if (!result) {
    return validateError('上传失败', 500)
  }

  // 10. ⚡ 异步触发语音识别，不阻塞上传响应
  recognizeAudio(fileBuffer, mimeType, result.id).catch(err => {
    logger.error('[recording upload] ASR 异步识别失败:', err)
  })

  return validateSuccess(result, '上传成功')
})

/** 异步语音识别：转文字后更新 recording.recognizedText */
async function recognizeAudio(audioBuffer: Buffer, mimeType: string, recordingId: number): Promise<void> {
  const format = MIME_TO_STT_FORMAT[mimeType] || 'mp3'
  const sttResult = await speechToText(audioBuffer, format as 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4')
  if (sttResult.success && sttResult.text) {
    await pool.execute(
      'UPDATE recording SET recognizedText = ? WHERE id = ?',
      [sttResult.text, recordingId]
    )
    logger.log('[recording upload] ASR 识别完成:', sttResult.text.slice(0, 60))
  } else {
    logger.warn('[recording upload] ASR 识别无结果:', sttResult.error)
  }
}

/** 验证文件魔数签名 */
function verifyMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (mimeType === 'audio/mp3' || mimeType === 'audio/mpeg') {
    return MP3_SIGNATURES.some(sig => sig.every((byte, i) => buf[i] === byte))
  }
  const expected = AUDIO_SIGNATURES[mimeType]
  if (!expected) return false
  return expected.every((byte, i) => buf[i] === byte)
}