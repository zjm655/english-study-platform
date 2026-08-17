/**
 * 管理员上传材料 DeepSeek 审核开关读取（server-only）
 *
 * 仿 deepseekConfig / uploadLimitChecker 的 sys_config 运行时读取模式：
 * - 内存缓存（TTL 5min），避免每次上传都查 sys_config
 * - 查库异常 / 键缺失一律按「开启」兜底（审核为主、fail-closed，缺省不放开闸门）
 */
import { query } from '#server/utils/db'

/** 开关键（与 041 迁移 seed 同族） */
const KEY = 'admin_moderation_enabled'

let cached: { data: boolean; expireAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/**
 * 纯映射：sys_config 行 → 开关布尔值（导出供单测；不触发查库）
 * 键缺失 / 非法值均按开启处理（fail-closed：缺省不放开审核主闸门）
 */
export function mapAdminModerationEnabled(
  rows: Array<{ config_key: string; config_value: string }>,
): boolean {
  const row = rows.find((r) => r.config_key === KEY)
  if (!row) return true
  return String(row.config_value).trim() === '1'
}

/** 读取管理员主文本 DeepSeek 审核开关（带缓存） */
export async function getAdminModerationEnabled(): Promise<boolean> {
  if (cached && Date.now() < cached.expireAt) {
    return cached.data
  }
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key = ?`,
      [KEY],
    )
    const data = mapAdminModerationEnabled(rows)
    cached = { data, expireAt: Date.now() + CACHE_TTL }
    return data
  } catch {
    // 查库失败按开启兜底，不阻塞也不放开闸门；不写缓存，下次仍尝试查库
    return true
  }
}

/** 使缓存失效（管理员修改 admin_moderation_enabled 后调用） */
export function invalidateAdminModerationCache(): void {
  cached = null
}