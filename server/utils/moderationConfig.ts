/**
 * 管理员上传材料 DeepSeek 审核开关读取（server-only）
 *
 * 仿 deepseekConfig / uploadLimitChecker 的 sys_config 运行时读取模式：
 * - 配置读取经 configStore（缓存语义由 configStore 承载，模块内不再自建缓存）
 * - 读取异常 / 键缺失一律按「开启」兜底（审核为主、fail-closed，缺省不放开闸门）
 */
import { getSysConfigKeys } from '#server/utils/configStore'

/** 开关键（与 041 迁移 seed 同族） */
const KEY = 'admin_moderation_enabled'

/**
 * 纯映射：configStore 结果 Map → 开关布尔值（导出供单测；不触发读取）
 * 键缺失 / 非法值均按开启处理（fail-closed：缺省不放开审核主闸门）
 */
export function mapAdminModerationEnabled(map: Map<string, string>): boolean {
  const value = map.get(KEY)
  if (value === undefined) return true
  return value.trim() === '1'
}

/** 读取管理员主文本 DeepSeek 审核开关（经 configStore；fail-closed 兜底留在本模块） */
export async function getAdminModerationEnabled(): Promise<boolean> {
  try {
    const map = await getSysConfigKeys([KEY])
    return mapAdminModerationEnabled(map)
  } catch {
    // 读取失败按开启兜底，不阻塞也不放开闸门
    return true
  }
}
