/**
 * DeepSeek 配置读取（server-only）
 *
 * 设计要点（仿 uploadLimitChecker）：
 * - 原硬编码超时（内容生成 30s / 标题生成 10s）与 max_tokens（内容 3000 / 标题 100）抽入 sys_config，运营可在管理端调整
 * - 内存缓存（TTL 5min），避免每次调用都查 sys_config
 * - 查库异常 / 键缺失 / 非法值一律兜底为默认值，旁路读取绝不阻断生成业务
 */
import { query } from '#server/utils/db'

/** DeepSeek 配置结构（超时 + max_tokens） */
export interface DeepseekParams {
  /** 学习内容生成超时（毫秒） */
  contentTimeoutMs: number
  /** 标题生成超时（毫秒） */
  titleTimeoutMs: number
  /** 学习内容生成 max_tokens */
  contentMaxTokens: number
  /** 标题生成 max_tokens */
  titleMaxTokens: number
}

/** 各配置项默认值（与 033 迁移 seed 值一致，查库失败时整体兜底） */
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 120_000
export const DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS = 60_000
export const DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS = 4000
export const DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS = 200

/** max_tokens 合法值下限（低于该值视为管理员误配，回退默认） */
const MAX_TOKENS_MIN = 100

/** sys_config 中的 4 个配置键（与 033_upload_audio_persist_and_deepseek_timeout.sql seed 同族） */
const KEYS = [
  'deepseek_timeout_ms',
  'deepseek_title_timeout_ms',
  'deepseek_max_tokens',
  'deepseek_title_max_tokens',
] as const

/** 缓存 sys_config 中的 DeepSeek 配置 */
let cached: { data: DeepseekParams; expireAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/**
 * 纯映射函数：sys_config 行 → DeepseekParams（导出供单测覆盖解析/兜底逻辑，不触发查库）
 * 单键粒度兜底：缺键 / NaN / 0 / 负数均回退到对应默认值；max_tokens 另校验 >= 100 才采用
 */
export function mapRowsToDeepseekParams(
  rows: Array<{ config_key: string; config_value: string }>,
): DeepseekParams {
  const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
  const pick = (key: string, fallback: number, min = 0): number => {
    const raw = parseInt(map.get(key) ?? '', 10)
    if (isNaN(raw) || raw <= 0) return fallback
    if (min > 0 && raw < min) return fallback
    return raw
  }
  return {
    contentTimeoutMs: pick('deepseek_timeout_ms', DEFAULT_DEEPSEEK_TIMEOUT_MS),
    titleTimeoutMs: pick('deepseek_title_timeout_ms', DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS),
    contentMaxTokens: pick(
      'deepseek_max_tokens',
      DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
      MAX_TOKENS_MIN,
    ),
    titleMaxTokens: pick(
      'deepseek_title_max_tokens',
      DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
      MAX_TOKENS_MIN,
    ),
  }
}

/** 获取 DeepSeek 配置（带缓存） */
export async function getDeepseekParams(): Promise<DeepseekParams> {
  if (cached && Date.now() < cached.expireAt) {
    return cached.data
  }
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN (${KEYS.map(() => '?').join(', ')})`,
      [...KEYS],
    )
    const data = mapRowsToDeepseekParams(rows)
    cached = { data, expireAt: Date.now() + CACHE_TTL }
    return data
  } catch {
    // 查询失败时返回全默认值，不阻塞生成业务（也不写缓存，下次仍尝试查库）
    return {
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
      contentMaxTokens: DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
      titleMaxTokens: DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
    }
  }
}

/** 使缓存失效（管理员修改 deepseek_ 前缀配置后调用） */
export function invalidateDeepseekConfigCache(): void {
  cached = null
}
