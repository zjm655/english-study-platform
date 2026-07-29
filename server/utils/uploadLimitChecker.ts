/**
 * 上传限制配置读取（server-only）
 *
 * 设计要点（仿 quotaChecker）：
 * - 原硬编码常量（时长/大小/录音上限/队列深度）抽入 sys_config，运营可在管理端调整
 * - 内存缓存（TTL 5min），避免每次上传请求都查 sys_config
 * - 查库异常 / 键缺失 / 非法值一律兜底为默认值，旁路读取绝不阻断上传业务
 * - 契约类型 UploadLimits 定义于 #shared/types/uploadLimits，前端预校验与单测共用
 */
import { query } from '#server/utils/db'
import type { UploadLimits } from '#shared/types/uploadLimits'

/** 各配置项默认值（与 024 迁移 seed 值一致，查库失败时整体兜底） */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxAudioDurationUser: 180,
  maxAudioDurationAdmin: 600,
  maxAudioSizeUser: 2 * 1024 * 1024,
  maxAudioSizeAdmin: 5 * 1024 * 1024,
  recordingMaxSize: 50 * 1024 * 1024,
  uploadQueueMax: 50,
}

/** sys_config 中的 6 个配置键（与 024_upload_limits.sql seed 一致） */
const UPLOAD_LIMIT_KEYS = [
  'upload_max_duration_user',
  'upload_max_duration_admin',
  'upload_max_size_user',
  'upload_max_size_admin',
  'upload_recording_max_size',
  'upload_queue_max',
] as const

/** 缓存 sys_config 中的上传限制配置 */
let cachedLimits: { limits: UploadLimits; expireAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/**
 * 纯映射函数：sys_config 行 → UploadLimits（导出供单测覆盖解析/兜底逻辑，不触发查库）
 * 单键粒度兜底：缺键 / NaN / 0 / 负数均回退到对应默认值
 */
export function mapRowsToUploadLimits(
  rows: Array<{ config_key: string; config_value: string }>,
): UploadLimits {
  const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
  const pick = (key: string, fallback: number): number => {
    const raw = parseInt(map.get(key) ?? '', 10)
    return isNaN(raw) || raw <= 0 ? fallback : raw
  }
  return {
    maxAudioDurationUser: pick(
      'upload_max_duration_user',
      DEFAULT_UPLOAD_LIMITS.maxAudioDurationUser,
    ),
    maxAudioDurationAdmin: pick(
      'upload_max_duration_admin',
      DEFAULT_UPLOAD_LIMITS.maxAudioDurationAdmin,
    ),
    maxAudioSizeUser: pick('upload_max_size_user', DEFAULT_UPLOAD_LIMITS.maxAudioSizeUser),
    maxAudioSizeAdmin: pick('upload_max_size_admin', DEFAULT_UPLOAD_LIMITS.maxAudioSizeAdmin),
    recordingMaxSize: pick('upload_recording_max_size', DEFAULT_UPLOAD_LIMITS.recordingMaxSize),
    uploadQueueMax: pick('upload_queue_max', DEFAULT_UPLOAD_LIMITS.uploadQueueMax),
  }
}

/** 获取上传限制配置（带缓存） */
export async function getUploadLimits(): Promise<UploadLimits> {
  if (cachedLimits && Date.now() < cachedLimits.expireAt) {
    return cachedLimits.limits
  }
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN (?, ?, ?, ?, ?, ?)`,
      [...UPLOAD_LIMIT_KEYS],
    )
    const limits = mapRowsToUploadLimits(rows)
    cachedLimits = { limits, expireAt: Date.now() + CACHE_TTL }
    return limits
  } catch {
    // 查询失败时返回全默认值，不阻塞上传业务（也不写缓存，下次仍尝试查库）
    return { ...DEFAULT_UPLOAD_LIMITS }
  }
}

/** 使缓存失效（管理员修改 upload_ 前缀配置后调用） */
export function invalidateUploadLimitCache(): void {
  cachedLimits = null
}
