/**
 * 上传限制配置读取（server-only）
 *
 * 设计要点（仿 quotaChecker）：
 * - 原硬编码常量（时长/大小/录音上限/队列深度）抽入 sys_config，运营可在管理端调整
 * - 配置读取经 configStore（getSysConfigKeys 一次批量 10 键，缓存语义由 configStore 承载）
 * - 读取异常 / 键缺失 / 非法值一律兜底为默认值，旁路读取绝不阻断上传业务
 * - 契约类型 UploadLimits 定义于 #shared/types/uploadLimits，前端预校验与单测共用
 * - 默认值单一真相源在 #shared/utils/uploadLimits（前端回退共用同一份，改默认值须同步迁移 seed）
 */
import { getSysConfigKeys } from '#server/utils/configStore'
import { DEFAULT_UPLOAD_LIMITS } from '#shared/utils/uploadLimits'
import type { UploadLimits } from '#shared/types/uploadLimits'

/** sys_config 中的 10 个配置键（与 024/040_upload_text_limits.sql seed 一致） */
const UPLOAD_LIMIT_KEYS = [
  'upload_max_duration_user',
  'upload_max_duration_admin',
  'upload_max_size_user',
  'upload_max_size_admin',
  'upload_recording_max_size',
  'upload_queue_max',
  'upload_min_text_user',
  'upload_max_text_user',
  'upload_min_text_admin',
  'upload_max_text_admin',
] as const

/** 缓存已收敛至 configStore（模块内不再自建缓存） */

/**
 * 纯映射函数：sys_config 行 → UploadLimits（导出供单测覆盖解析/兜底逻辑，不触发读取）
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
    minTextUser: pick('upload_min_text_user', DEFAULT_UPLOAD_LIMITS.minTextUser),
    maxTextUser: pick('upload_max_text_user', DEFAULT_UPLOAD_LIMITS.maxTextUser),
    minTextAdmin: pick('upload_min_text_admin', DEFAULT_UPLOAD_LIMITS.minTextAdmin),
    maxTextAdmin: pick('upload_max_text_admin', DEFAULT_UPLOAD_LIMITS.maxTextAdmin),
  }
}

/** 获取上传限制配置（经 configStore 一次批量读取；解析与默认值兜底留在本模块） */
export async function getUploadLimits(): Promise<UploadLimits> {
  try {
    const map = await getSysConfigKeys([...UPLOAD_LIMIT_KEYS])
    const rows = [...map.entries()].map(([config_key, config_value]) => ({
      config_key,
      config_value,
    }))
    return mapRowsToUploadLimits(rows)
  } catch {
    // 读取失败时返回全默认值，不阻塞上传业务
    return { ...DEFAULT_UPLOAD_LIMITS }
  }
}

/** 上传文本校验角色档位：管理员 / 普通用户（各档独立上下限配置） */
export type UploadTextRole = 'user' | 'admin'

/**
 * 上传材料文本长度校验（纯函数，无 IO）：
 * trim 后按角色档位校验上下限；校验通过返回 trim 后文本供调用方复用（避免重复 trim）。
 * 空串 / 纯空白一律拒绝（先于下限判断，文案更友好）。
 */
export function validateUploadText(
  text: string,
  limits: UploadLimits,
  role: UploadTextRole,
): { ok: true; text: string } | { ok: false; message: string } {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, message: '材料文本不能为空' }
  }
  const min = role === 'admin' ? limits.minTextAdmin : limits.minTextUser
  const max = role === 'admin' ? limits.maxTextAdmin : limits.maxTextUser
  if (trimmed.length < min) {
    return { ok: false, message: `材料文本不能少于${min}个字符` }
  }
  if (trimmed.length > max) {
    return { ok: false, message: `材料文本不能超过${max}个字符` }
  }
  return { ok: true, text: trimmed }
}
