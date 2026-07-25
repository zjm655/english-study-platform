// server/api/oss/playback.post.ts
// 前端 OSS 外网播放埋点端点：累计一次「经签名 URL 直连 OSS 的播放」到 oss_playback_daily。
//
// 为何需要：浏览器直连 OSS 播放（外网下行，OSS 唯一实际计费项）绕过本服务，
// api_call_log 无从统计；前端在音频加载时 fire-and-forget 上报到此端点。
//
// 关键排除（见 apiCallLogger.ts / rateLimiter.ts）：
// - 本端点自身不写 api_call_log（否则每次播放都自记录，放大埋点表且污染统计）。
// - 单独配置宽松限流桶（播放频次远高于默认 60/min，避免 IP 级/用户级误伤）。
import { recordOssPlayback } from '#server/utils/ossPlaybackLog'
import { validateSuccess } from '#server/utils/validate'

export default defineEventHandler((): ResPayload<null> => {
  // 鉴权由全局 auth 中间件保证（登录用户，非公开白名单）；此处仅入队计数。
  recordOssPlayback()
  return validateSuccess(null)
})
