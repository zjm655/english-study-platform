// server/api/user/avatar.post.ts
import { query } from '#server/utils/db'
import { uploadImagePublic, signAvatarUrl } from '#server/utils/oss'
import type { ResPayload } from '#shared/types/request'

// ============ 安全配置 ============
/** 头像文件大小上限：2MB */
const AVATAR_MAX_SIZE = 2 * 1024 * 1024

// MIME 白名单 + 对应魔数签名（参照录音上传端点的 verifyMagicBytes 模式）
const IMAGE_SIGNATURES: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff], // JPEG
  'image/png': [0x89, 0x50, 0x4e, 0x47], // \x89PNG
}
// webp 需双段校验：前 4 字节 RIFF + 第 8-11 字节 WEBP
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WEBP_MARK = [0x57, 0x45, 0x42, 0x50] // "WEBP"

/**
 * 上传头像：multipart 读取 → 大小/MIME/魔数校验 → 上传 OSS avatars/ 前缀 → 更新 avatarUrl
 * 请求：POST /api/user/avatar (multipart/form-data，文件字段名 file)
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<{ avatarUrl: string } | null>> => {
    const userId = event.context.user.id

    // 1. 解析 multipart，取 file 字段
    const parts = await readMultipartFormData(event)
    const file = parts?.find((p) => p.name === 'file')
    if (!file || !file.data || file.data.length === 0) {
      return validateError('未上传头像文件')
    }

    // 2. 大小校验
    if (file.data.length > AVATAR_MAX_SIZE) {
      return validateError(`头像大小不能超过${AVATAR_MAX_SIZE / 1024 / 1024}MB`)
    }

    // 3. MIME 类型白名单校验
    const mimeType = file.type ?? ''
    const allowedMimes = [...Object.keys(IMAGE_SIGNATURES), 'image/webp']
    if (!allowedMimes.includes(mimeType)) {
      return validateError('仅支持 JPG/PNG/WebP 格式的图片')
    }

    // 4. 魔数校验（防伪造 MIME）
    if (!verifyImageMagicBytes(file.data, mimeType)) {
      return validateError('文件内容与声明类型不匹配')
    }

    // 5. 上传 OSS（avatars/ 前缀，key 含 userId 与时间戳；文件名带扩展名避免默认 .png 兜底失真；
    //    bucket 阻止公共访问，对象恒定私有，访问时统一走 signAvatarUrl 临时签名）
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp'
    let avatarUrl: string
    try {
      const result = await uploadImagePublic(file.data, `${userId}.${ext}`, 'avatars/')
      avatarUrl = result.url
    } catch (err) {
      logger.error('[avatar upload] OSS 上传失败:', err)
      return validateError('头像上传失败，请稍后重试', 500)
    }

    // 6. 更新用户头像 URL（落库存完整公网 URL；旧头像对象不做清理，孤儿文件已知残留）
    await query('UPDATE user SET avatarUrl = ? WHERE id = ?', [avatarUrl, userId])

    // 响应返回签名 URL，保证上传后前端立即可展示
    return validateSuccess(
      { avatarUrl: (await signAvatarUrl(avatarUrl)) ?? avatarUrl },
      '头像更新成功',
    )
  },
)

/** 验证图片魔数签名（webp 需同时校验 RIFF 头与 WEBP 标记） */
function verifyImageMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/webp') {
    return (
      WEBP_RIFF.every((byte, i) => buf[i] === byte) &&
      WEBP_MARK.every((byte, i) => buf[8 + i] === byte)
    )
  }
  const expected = IMAGE_SIGNATURES[mimeType]
  if (!expected) return false
  return expected.every((byte, i) => buf[i] === byte)
}
