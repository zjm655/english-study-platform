/**
 * 游客音频签名 URL 获取（限流）
 *
 * GET /api/guest/audio-url?type=material|word&key=<object_key>
 *
 * - 验证 guest_token cookie（无有效 token → 401）
 * - 检查每日配额（超限 → 429）
 * - 生成签名 URL 返回
 */
import { readGuestKey } from '#server/utils/guest'
import { getClientIp } from '#server/utils/clientIp'
import { checkGuestAudioLimit } from '#server/utils/guestOssLimit'
import { checkGuestAudioByIp } from '#server/utils/guestIpGuard'
import { signUrl, MATERIAL_EXPIRE, WORD_EXPIRE } from '#server/utils/oss'
import { findMediaByObjectKey } from '#server/utils/media'

export default defineEventHandler(async (event) => {
  // 1. 验证游客身份
  const guestKey = await readGuestKey(event)
  if (!guestKey) {
    return validateError('未提供有效的游客身份', 401)
  }

  // 2. 解析参数
  const params = getQuery(event)
  const type = params.type as string
  const key = params.key as string

  if (!type || (type !== 'material' && type !== 'word')) {
    return validateError('参数 type 必须为 material 或 word')
  }
  if (!key || typeof key !== 'string') {
    return validateError('缺少参数 key')
  }

  // 3. 校验 key 合法性：防止 IDOR，只允许 media 表中已存在的音频资源
  const mediaRow = await findMediaByObjectKey(key)
  if (!mediaRow) {
    return validateError('无效的音频资源', 404)
  }

  // 4. 检查每日配额（P3-C：身份额度 + IP 维度兜底——guest_key 可轮换，IP 兜底防脚本换键清零）
  const { allowed } = await checkGuestAudioLimit(guestKey)
  if (!allowed) {
    event.node.res.statusCode = 429
    return validateError('今日音频播放次数已用完，登录后可无限使用', 429)
  }
  if (!checkGuestAudioByIp(getClientIp(event))) {
    event.node.res.statusCode = 429
    return validateError('今日音频播放次数已用完，登录后可无限使用', 429)
  }

  // 5. 生成签名 URL
  const expires = type === 'material' ? MATERIAL_EXPIRE : WORD_EXPIRE
  const signedUrl = await signUrl(key, expires)

  return validateSuccess({ url: signedUrl })
})
