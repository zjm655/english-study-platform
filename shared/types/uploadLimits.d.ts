/**
 * 上传限制配置（运营可调，存于 sys_config）
 * 公开接口 GET /api/config/upload-limits 下发，前端上传前本地预校验与服务端校验共用同一契约
 */
export interface UploadLimits {
  /** 普通用户上传/录制音频最大时长（秒） */
  maxAudioDurationUser: number
  /** 管理员上传/录制音频最大时长（秒） */
  maxAudioDurationAdmin: number
  /** 普通用户音频最大字节数 */
  maxAudioSizeUser: number
  /** 管理员音频最大字节数 */
  maxAudioSizeAdmin: number
  /** 录音上传文件大小上限（字节） */
  recordingMaxSize: number
  /** 上传队列待处理深度上限 */
  uploadQueueMax: number
}
