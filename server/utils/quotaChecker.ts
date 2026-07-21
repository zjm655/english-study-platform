/**
 * 用户每日评测额度检查（server-only）
 *
 * 设计要点：
 * - 查询 recording 表当日已用次数，对比 sys_config 中的 daily_eval_limit
 * - 管理员（role=1）不受限制
 * - 内存缓存 config 值（TTL 5min），避免每次请求查 sys_config
 * - 在评测鉴权（evaluation/auth）之前调用，拦截超限请求避免无效阿里云调用
 */
import { query } from '#server/utils/db'
import { ROLE_ADMIN } from '#shared/utils/role'

interface QuotaResult {
  allowed: boolean
  used: number
  limit: number
}

/** 缓存 sys_config 中的 daily_eval_limit 值 */
let cachedLimit: { value: number; expireAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/** 获取每日评测上限（带缓存） */
async function getDailyLimit(): Promise<number> {
  if (cachedLimit && Date.now() < cachedLimit.expireAt) {
    return cachedLimit.value
  }
  try {
    const rows = await query<{ config_value: string }>(
      `SELECT config_value FROM sys_config WHERE config_key = 'daily_eval_limit'`,
    )
    const val = parseInt(rows[0]?.config_value ?? '20', 10)
    const limit = isNaN(val) || val < 0 ? 20 : val
    cachedLimit = { value: limit, expireAt: Date.now() + CACHE_TTL }
    return limit
  } catch {
    // 查询失败时返回默认值，不阻塞业务
    return 20
  }
}

/** 使缓存失效（管理员修改配置后调用） */
export function invalidateQuotaCache(): void {
  cachedLimit = null
}

/**
 * 检查用户今日评测额度
 * @param userId 用户 ID
 * @param role   用户角色（管理员不受限）
 */
export async function checkDailyQuota(userId: number, role: number): Promise<QuotaResult> {
  // 管理员不受限
  if (role === ROLE_ADMIN) {
    return { allowed: true, used: 0, limit: Infinity }
  }

  const limit = await getDailyLimit()

  // 查询今日已用次数（recording 表每次评测必新增）
  const rows = await query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM recording WHERE user_id = ? AND DATE(createdAt) = CURDATE() AND deleted_at IS NULL`,
    [userId],
  )
  const used = Number(rows[0]?.cnt ?? 0)

  return {
    allowed: used < limit,
    used,
    limit,
  }
}
