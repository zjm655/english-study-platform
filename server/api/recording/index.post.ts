import { randomUUID } from 'node:crypto'
import { withTransaction } from '#server/utils/db'
import { getClientIp } from '#server/utils/clientIp'
import { checkGuestUploadByIp, checkGuestUploadByFp } from '#server/utils/guestIpGuard'
import { uploadWithKey, signUrl, deleteObject, RECORDING_EXPIRE } from '#server/utils/oss'
import { validateError, validateSuccess } from '#server/utils/validate'
import { uploadRecordingSchema } from '#shared/schemas/user'
import { getUploadLimits } from '#server/utils/uploadLimitChecker'
import { ensureGuestUserByFingerprint } from '#server/services/guestUser'
import { readGuestKey } from '#server/utils/guest'

import type { RecordingRow } from '#server/types/db'
import type { UploadRecordingResult } from '#shared/types/recording'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'

// ============ 安全配置 ============
// 文件大小上限已抽入 sys_config（upload_recording_max_size）运营可调，handler 内动态读取

// MIME 白名单 + 对应魔数签名（前 N 字节）
const AUDIO_SIGNATURES: Record<string, number[]> = {
  'audio/webm': [0x1a, 0x45, 0xdf, 0xa3], // EBML
  'audio/ogg': [0x4f, 0x67, 0x67, 0x53], // OggS
  'audio/wav': [0x52, 0x49, 0x46, 0x46], // RIFF
  'audio/x-wav': [0x52, 0x49, 0x46, 0x46], // RIFF
}
// mp3/mpeg 允许两种魔数：ID3v2 标签或帧同步
const MP3_SIGNATURES = [
  [0x49, 0x44, 0x33], // "ID3"
  [0xff, 0xfb],
  [0xff, 0xf3],
  [0xff, 0xf2], // 帧同步
]

/**
 * 上传录音
 * 请求：POST /api/recording (multipart/form-data)
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<UploadRecordingResult | null>> => {
    // 身份解析：登录用户走 event.context.user（auth 中间件已设置），游客走浏览器指纹
    const loggedInUserId = event.context.user?.id
    const fingerprint = !loggedInUserId
      ? (getRequestHeader(event, 'x-guest-fingerprint') ?? null)
      : null
    if (!loggedInUserId && !fingerprint) return validateError('未登录', 401)
    // 指纹格式校验：SHA-256 为 64 位十六进制
    if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) {
      return validateError('指纹格式无效')
    }

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

    // 4. 文件大小二次校验（上限运营可调，取自 sys_config）
    if (file.size === 0) return validateError('文件为空')
    const { recordingMaxSize } = await getUploadLimits()
    if (file.size > recordingMaxSize) {
      return validateError(`文件大小超过限制(${Math.round(recordingMaxSize / 1024 / 1024)}MB)`)
    }

    // 4.5 游客每日上传配额（P4-A1：IP 50 次/日 + 指纹 20 次/日，防换指纹无限灌库；登录用户不限）
    if (fingerprint) {
      if (!checkGuestUploadByIp(getClientIp(event)) || !checkGuestUploadByFp(fingerprint)) {
        return validateError('今日录音上传次数已用完，登录后可无限使用', 429)
      }
    }

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

    logger.info(
      `[recording upload] 收到录音上传 ${loggedInUserId ? `user=${loggedInUserId}` : `guest=${fingerprint?.slice(0, 8)}`} segment=${segmentId} phase=${phase} ${mimeType} ${file.size}B`,
    )

    // 8. 上传到 OSS
    const ext =
      mimeType === 'audio/webm'
        ? 'webm'
        : mimeType === 'audio/ogg'
          ? 'ogg'
          : mimeType === 'audio/wav' || mimeType === 'audio/x-wav'
            ? 'wav'
            : 'mp3'
    const ossKey = `audio/recordings/${randomUUID()}.${ext}`

    try {
      await uploadWithKey(fileBuffer, ossKey)
    } catch (err) {
      logger.error('[recording upload] OSS 上传失败:', err)
      return validateError('文件上传失败，请稍后重试', 500)
    }

    // 9. 写入 media 表 + recording 表（事务）
    let result: UploadRecordingResult | null

    try {
      result = await withTransaction(async (conn) => {
        // 游客身份懒实体化：优先用 guest_token（guest_key）解析，保证与评测限流查同一 user 行；
        // 指纹仅作兜底（无 guest_token 时）
        let userId: number
        if (loggedInUserId) {
          userId = loggedInUserId
        } else {
          // 优先通过 guest_token 查找已实体化的游客行
          const guestKey = await readGuestKey(event)
          let guestUserId: number | null = null
          if (guestKey) {
            const [rows] = await conn.execute<(RowDataPacket & { id: number })[]>(
              'SELECT id FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL LIMIT 1 FOR UPDATE',
              [guestKey],
            )
            const guestRow = rows[0]
            if (guestRow) {
              guestUserId = guestRow.id
              // 顺便把指纹关联到同一行（best-effort，指纹已被其他行占用时跳过）
              try {
                await conn.execute(
                  'UPDATE IGNORE user SET fingerprint_hash = ? WHERE id = ? AND fingerprint_hash IS NULL',
                  [fingerprint, guestUserId],
                )
              } catch {
                /* 指纹关联失败不影响录音归属 */
              }
            }
          }
          if (guestUserId != null) {
            userId = guestUserId
          } else {
            const ensured = await ensureGuestUserByFingerprint(conn, fingerprint!)
            if (ensured.conflict) {
              throw new Error('GUEST_CONFLICT')
            }
            userId = ensured.userId
          }
        }

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
          ],
        )
        const mediaId = mediaRes.insertId

        // 9b. 插入 recording 表（关联 media_id）
        const [recRes] = await conn.execute<ResultSetHeader>(
          'INSERT INTO recording (user_id, segment_id, phase, media_id, duration) VALUES (?, ?, ?, ?, ?)',
          [userId, segmentId, phase, mediaId, duration],
        )

        // 9c. 查回完整记录
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT r.*, m.object_key AS rec_media_key
         FROM recording r
         LEFT JOIN media m ON r.media_id = m.id
         WHERE r.id = ? AND r.deleted_at IS NULL`,
          [recRes.insertId],
        )
        const row = rows[0] as RecordingRow & { rec_media_key: string }

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
      // 游客行已被合并（残留指纹），需客户端重新生成指纹
      if (err instanceof Error && err.message === 'GUEST_CONFLICT') {
        return validateError('游客身份已失效，请刷新页面', 401)
      }
      logger.error('[recording upload] 事务失败:', err)
      // 先传 OSS 后写库，事务失败则删除已上传对象，避免 OSS 孤儿文件（best-effort）
      void deleteObject(ossKey)
      return validateError('上传失败，请稍后重试', 500)
    }

    if (!result) {
      return validateError('上传失败', 500)
    }

    logger.info(`[recording upload] 上传成功 id=${result.id} key=${ossKey}`)
    return validateSuccess(result, '上传成功')
  },
)

/** 验证文件魔数签名 */
function verifyMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (mimeType === 'audio/mp3' || mimeType === 'audio/mpeg') {
    return MP3_SIGNATURES.some((sig) => sig.every((byte, i) => buf[i] === byte))
  }
  const expected = AUDIO_SIGNATURES[mimeType]
  if (!expected) return false
  return expected.every((byte, i) => buf[i] === byte)
}
