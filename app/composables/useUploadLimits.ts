// app/composables/useUploadLimits.ts
import type { UploadLimits } from '#shared/types/uploadLimits'

/**
 * 内置静态默认值（与后端 sys_config 默认值同源）：
 * 接口失败/未就绪时静默回退，保证上传前本地预校验始终可用
 */
export const UPLOAD_LIMITS_FALLBACK: UploadLimits = {
  maxAudioDurationUser: 180,
  maxAudioDurationAdmin: 600,
  maxAudioSizeUser: 2097152,
  maxAudioSizeAdmin: 5242880,
  recordingMaxSize: 52428800,
  uploadQueueMax: 50,
}

/** 公开只读接口（无鉴权，游客白名单），见 server/api/config/upload-limits.get.ts */
const uploadLimitsPath = '/api/config/upload-limits'

// 进行中的请求（模块级去重）：仅 client 侧发起 fetch，不存在 SSR 跨请求串态问题
let inflight: Promise<void> | null = null

/**
 * 上传限制配置（运营可在管理端调整，5min 内生效）
 *
 * 读链路遵循「写弹读静默」：拉取失败不弹 toast，静默回退内置默认值。
 * useState 全局缓存，同一会话只拉取一次；SSR 期直接返回默认值（预校验只发生在 client）。
 */
export function useUploadLimits() {
  // 全局缓存：初始即为内置默认值，任何时刻读取都有可用值
  const limits = useState<UploadLimits>('upload-limits', () => ({ ...UPLOAD_LIMITS_FALLBACK }))
  const loaded = useState<boolean>('upload-limits-loaded', () => false)

  /** 确保已从服务端拉取（失败保持默认值，下次调用会自动重试） */
  async function ensureLoaded() {
    if (loaded.value || import.meta.server) return
    if (!inflight) {
      inflight = request<UploadLimits>(uploadLimitsPath, { method: 'GET' })
        .then((res) => {
          if (res?.code === 200 && res.data) {
            limits.value = res.data
            loaded.value = true
          }
        })
        .catch(() => {
          // 读静默：网络/接口异常时继续使用内置默认值，不打扰用户
        })
        .finally(() => {
          inflight = null
        })
    }
    await inflight
  }

  // 首次使用即在 client 侧触发拉取（不阻塞 setup）
  if (import.meta.client) void ensureLoaded()

  return { limits, ensureLoaded }
}
