// app/composables/useUploadLimits.ts
import type { UploadLimits } from '#shared/types/uploadLimits'
import type { ResPayload } from '#shared/types/request'

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
  minTextUser: 10,
  maxTextUser: 5000,
  minTextAdmin: 10,
  maxTextAdmin: 5000,
}

/** 公开只读接口（无鉴权，游客白名单），见 server/api/config/upload-limits.get.ts */
const uploadLimitsPath = '/api/config/upload-limits'

/**
 * 上传限制配置（运营可在管理端调整，5min 内生效）
 *
 * 读链路遵循「写弹读静默」：拉取失败不弹 toast，静默回退内置默认值。
 * 使用 useAsyncData + useRequestFetch 实现 SSR 友好 + dedupe:'defer' 去重。
 */
export function useUploadLimits() {
  const requestFetch = useRequestFetch()

  const { data } = useAsyncData<UploadLimits | null>(
    'upload-limits',
    () =>
      requestFetch<ResPayload<UploadLimits>>(uploadLimitsPath, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
        .then((res: ResPayload<UploadLimits>) => (res?.code === 200 ? res.data : null))
        .catch(() => null),
    {
      // 仅客户端发起（SSR 期不请求，直接用内置默认值）
      server: false,
      // 同 key 并发/重复请求自动去重
      dedupe: 'defer',
    },
  )

  // 接口成功则用服务端值，失败/未就绪则回退内置静态默认
  const limits = computed<UploadLimits>(() => data.value ?? { ...UPLOAD_LIMITS_FALLBACK })

  return { limits }
}
