/**
 * 游客音频 URL 解析辅助 composable
 *
 * 登录用户直接使用 segment/vocab 的 audioUrl（后端已签名）；
 * 游客 audioUrl 为 null，需通过 audioObjectKey 调用游客限流接口动态获取签名 URL。
 */
import { getGuestAudioUrl } from '~/api/guest'

/**
 * 解析音频 URL：登录用户直接返回 src，游客通过 objectKey 动态获取。
 * @param audioUrl     现有音频 URL（登录用户非 null，游客 null）
 * @param objectKey    音频对象键（游客场景使用）
 * @param type         音频类型：material=材料音频，word=单词音频
 * @returns 签名 URL 或 null（获取失败/超限）
 */
export async function resolveGuestAudioUrl(
  audioUrl: string | null,
  objectKey: string | null | undefined,
  type: 'material' | 'word',
): Promise<string | null> {
  // 登录用户：直接使用已有签名 URL
  if (audioUrl) return audioUrl
  // 游客：通过 objectKey 动态获取
  if (!objectKey) return null
  const res = await getGuestAudioUrl(type, objectKey)
  if (res?.code === 200 && res.data?.url) {
    return res.data.url
  }
  // 429 超限或其他错误
  return null
}
