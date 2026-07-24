/**
 * 用户评测额度检查（server-only）
 *
 * 设计要点：
 * - 查询 eval_auth_log 表窗口内的评测鉴权发放次数，对比 sys_config 中的 daily_eval_limit / eval_limit_window
 * - 管理员 / 超管不受限制
 * - 内存缓存 config 值（TTL 5min），避免每次请求查 sys_config
 * - 在评测鉴权（evaluation/auth）之前调用，拦截超限请求避免无效阿里云调用
 */
import { query } from '#server/utils/db'
import { isAdminOrAbove } from '#shared/utils/role'

export interface QuotaResult {
  allowed: boolean
  used: number
  limit: number
  /** 时间窗口（秒），供错误提示动态描述用 */
  windowSec: number
}

/** 缓存 sys_config 中的评测额度配置 */
let cachedConfig: { limit: number; windowSec: number; expireAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/** 获取评测额度配置（带缓存） */
async function getEvalConfig(): Promise<{ limit: number; windowSec: number }> {
  if (cachedConfig && Date.now() < cachedConfig.expireAt) {
    return { limit: cachedConfig.limit, windowSec: cachedConfig.windowSec }
  }
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN ('daily_eval_limit', 'eval_limit_window')`,
    )
    const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
    const rawLimit = parseInt(map.get('daily_eval_limit') ?? '20', 10)
    const rawWindow = parseInt(map.get('eval_limit_window') ?? '86400', 10)
    const limit = isNaN(rawLimit) || rawLimit < 0 ? 20 : rawLimit
    const windowSec = isNaN(rawWindow) || rawWindow < 1 ? 86400 : rawWindow
    cachedConfig = { limit, windowSec, expireAt: Date.now() + CACHE_TTL }
    return { limit, windowSec }
  } catch {
    // 查询失败时返回默认值，不阻塞业务
    return { limit: 20, windowSec: 86400 }
  }
}

/** 使缓存失效（管理员修改配置后调用） */
export function invalidateQuotaCache(): void {
  cachedConfig = null
}

/**
 * 检查用户评测额度（窗口模式）
 * @param userId 用户 ID
 * @param role   用户角色（管理员不受限）
 */
export async function checkDailyQuota(userId: number, role: number): Promise<QuotaResult> {
  // 管理员 / 超管不受限
  if (isAdminOrAbove(role)) {
    return { allowed: true, used: 0, limit: Infinity, windowSec: 0 }
  }

  const { limit, windowSec } = await getEvalConfig()

  // 查询窗口内已发放的评测鉴权次数（真正的云调用成本驱动点）。
  // 注：不再按 recording.analyze_status='success' 计数——warrantId 由客户端 SDK 消费、
  // analyze 回写由客户端控制，用户不回写即计数不增长即可绕过额度。改为对服务端侧
  // 「授权发放」计数（见 evaluation/auth.post.ts 的 eval_auth_log 落库）堵死绕过。
  const rows = await query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM eval_auth_log WHERE user_id = ? AND createdAt > DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [userId, windowSec],
  )
  const used = Number(rows[0]?.cnt ?? 0)

  return {
    allowed: used < limit,
    used,
    limit,
    windowSec,
  }
}
