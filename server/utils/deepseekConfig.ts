/**
 * DeepSeek 配置读取（server-only）
 *
 * 设计要点（仿 uploadLimitChecker）：
 * - 原硬编码超时（内容生成 30s / 标题生成 10s）与 max_tokens（内容 3000 / 标题 100）抽入 sys_config，运营可在管理端调整
 * - 配置读取经 configStore（getSysConfigKeys 一次批量 4 键，缓存语义由 configStore 承载）
 * - 读取异常 / 键缺失 / 非法值一律兜底为默认值，旁路读取绝不阻断生成业务
 */
import { getSysConfigKeys } from '#server/utils/configStore'

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

/** 缓存已收敛至 configStore（模块内不再自建缓存） */

/**
 * 纯映射函数：sys_config 行 → DeepseekParams（导出供单测覆盖解析/兜底逻辑，不触发读取）
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

/** 获取 DeepSeek 配置（经 configStore 一次批量读取；解析与默认值兜底留在本模块） */
export async function getDeepseekParams(): Promise<DeepseekParams> {
  try {
    const map = await getSysConfigKeys([...KEYS])
    const rows = [...map.entries()].map(([config_key, config_value]) => ({
      config_key,
      config_value,
    }))
    return mapRowsToDeepseekParams(rows)
  } catch {
    // 读取失败时返回全默认值，不阻塞生成业务
    return {
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
      contentMaxTokens: DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
      titleMaxTokens: DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
    }
  }
}
