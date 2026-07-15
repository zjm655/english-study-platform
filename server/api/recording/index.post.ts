import { writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pool, query, withTransaction } from '#server/utils/db'
import { validateError, validateSuccess, uploadRecordingSchema } from '#server/utils/validate'
import { rowToRecording } from '#server/utils/recording'
import type { RecordingRow } from '#server/types/db'
import type { UploadRecordingResult } from '#shared/types/recording'
import type { ResultSetHeader } from 'mysql2'

// ============ 安全配置 ============
const UPLOAD_DIR = resolve('public/uploads/recordings')
const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50MB

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

  // 8. 生成安全文件名（UUID，不含用户输入）
  const ext = mimeType === 'audio/webm' ? 'webm'
    : mimeType === 'audio/ogg' ? 'ogg'
    : mimeType === 'audio/wav' || mimeType === 'audio/x-wav' ? 'wav'
    : 'mp3'
  const safeFilename = `${randomUUID()}.${ext}`
  const safePath = join(UPLOAD_DIR, safeFilename)

  // 9. 路径穿越防御：验证解析后路径仍在 UPLOAD_DIR 内
  const resolvedPath = resolve(safePath)
  if (!resolvedPath.startsWith(UPLOAD_DIR + sep)) {
    return validateError('路径非法', 400)
  }

  // 10. 确保目录存在并写入文件
  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(resolvedPath, fileBuffer)

  // 11. 存入数据库（使用事务保证一致性）
  const audioPath = `/uploads/recordings/${safeFilename}`
  let recording: ReturnType<typeof rowToRecording> = null

  try {
    recording = await withTransaction(async (conn) => {
      const [result] = await conn.execute<ResultSetHeader>(
        'INSERT INTO recording (user_id, segment_id, phase, audioPath, duration) VALUES (?, ?, ?, ?, ?)',
        [userId, segmentId, phase, audioPath, duration]
      )
      const insertId = result.insertId

      // 查回完整记录（事务内查询，使用 conn.execute 确保连接一致性）
      const [rows] = await conn.execute<RecordingRow[]>(
        'SELECT * FROM recording WHERE id = ? AND deleted_at IS NULL',
        [insertId]
      )
      return rowToRecording(rows[0])
    })
  } catch (err) {
    // 事务失败时回滚，并删除已写入的文件避免脏文件
    try {
      await unlink(resolvedPath)
    } catch {
      // 忽略文件删除失败（可能文件不存在）
    }
    console.error('[recording upload] 事务失败:', err)
    return validateError('上传失败，请稍后重试', 500)
  }

  if (!recording) {
    return validateError('上传失败', 500)
  }

  return validateSuccess({
    id: recording.id,
    audioPath: recording.audioPath ?? '',
    duration: recording.duration ?? 0,
    createdAt: recording.createdAt,
  } satisfies UploadRecordingResult, '上传成功')
})

/** 验证文件魔数签名 */
function verifyMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (mimeType === 'audio/mp3' || mimeType === 'audio/mpeg') {
    return MP3_SIGNATURES.some(sig => sig.every((byte, i) => buf[i] === byte))
  }
  const expected = AUDIO_SIGNATURES[mimeType]
  if (!expected) return false
  return expected.every((byte, i) => buf[i] === byte)
}
