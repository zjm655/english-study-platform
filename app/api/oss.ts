import { ossPlaybackPath } from './paths'

/**
 * 上报一次 OSS 外网播放（fire-and-forget 埋点）。
 *
 * 浏览器经签名 URL 直连 OSS 播放会产生外网下行流量（OSS 唯一实际计费项），
 * 但绕过本服务 /api，api_call_log 无从记录，故前端在音频加载时主动上报。
 *
 * 传输优先 navigator.sendBeacon（页面卸载时仍可送达、不阻塞主线程），
 * 不可用时回退 fetch keepalive。鉴权走同源 Cookie，无需额外头部。
 * 埋点为旁路能力，任何失败均静默忽略，绝不影响播放体验。
 */
export function reportOssPlayback(): void {
  if (!import.meta.client) return
  try {
    // sendBeacon 需 Blob 载荷；空 JSON 体即可（服务端仅计数，鉴权靠 Cookie）
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob(['{}'], { type: 'application/json' })
      navigator.sendBeacon(ossPlaybackPath, blob)
      return
    }
  } catch {
    // sendBeacon 异常时回退 fetch
  }
  void fetch(ossPlaybackPath, {
    method: 'POST',
    keepalive: true,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => {
    // 埋点失败静默忽略
  })
}
