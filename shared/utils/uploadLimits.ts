// shared/utils/uploadLimits.ts
// 上传限制默认值（前后端单一真相源）：
// 服务端兜底（server/utils/uploadLimitChecker.ts，查库失败/缺键/非法值回退）与
// 前端静态回退（app/composables/useUploadLimits.ts，接口失败/未就绪回退）共同引用本常量，
// 两端默认值不可能再出现不同值；契约类型见 #shared/types/uploadLimits。
// 改默认值须同步迁移 seed（024_upload_limits.sql / 040_upload_text_limits.sql）——两处同步。

import type { UploadLimits } from '#shared/types/uploadLimits'

/** 各配置项默认值（与 024/040 迁移 seed 值一致） */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxAudioDurationUser: 180,
  maxAudioDurationAdmin: 600,
  maxAudioSizeUser: 2 * 1024 * 1024,
  maxAudioSizeAdmin: 5 * 1024 * 1024,
  recordingMaxSize: 50 * 1024 * 1024,
  uploadQueueMax: 50,
  minTextUser: 10,
  maxTextUser: 5000,
  minTextAdmin: 10,
  maxTextAdmin: 5000,
}
