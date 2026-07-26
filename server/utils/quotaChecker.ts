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
import type { EvalGateSnapshot } from '#shared/types/adminMonitor'

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
  cachedGateConfig = null
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

// ==================== 评测并发闸门（拒绝型） ====================
//
// 与上方「每用户额度」正交：闸门限制的是全局同时进行的评测数（阿里云智能科教并发配额保护）。
// 评测由前端 SDK 直连阿里云执行，服务端无法排队等待，只能在 warrantId 发放前拒绝；
// 活跃数用 eval_auth_log 近窗发放计数估算（窗口默认 = warrantId 有效期 300s），
// 属近似值——阈值宜宽松，阿里云真实拒绝作最后兜底。

export interface EvalGateResult {
  allowed: boolean
  active: number
  limit: number
}

let cachedGateConfig: { max: number; windowSec: number; expireAt: number } | null = null

async function getGateConfig(): Promise<{ max: number; windowSec: number }> {
  if (cachedGateConfig && Date.now() < cachedGateConfig.expireAt) {
    return { max: cachedGateConfig.max, windowSec: cachedGateConfig.windowSec }
  }
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN ('eval_gate_max', 'eval_gate_window')`,
    )
    const map = new Map(rows.map((r) => [r.config_key, r.config_value]))
    const rawMax = parseInt(map.get('eval_gate_max') ?? '20', 10)
    const rawWindow = parseInt(map.get('eval_gate_window') ?? '300', 10)
    const max = isNaN(rawMax) || rawMax < 0 ? 20 : rawMax
    const windowSec = isNaN(rawWindow) || rawWindow < 1 ? 300 : rawWindow
    cachedGateConfig = { max, windowSec, expireAt: Date.now() + CACHE_TTL }
    return { max, windowSec }
  } catch {
    // 查询失败不阻塞业务：按默认值处理
    return { max: 20, windowSec: 300 }
  }
}

/**
 * 检查全局评测并发闸门（在 evaluation/auth 的每日额度检查之后调用）。
 * max=0 表示不限制；管理员不豁免（保护的是云产品配额，与角色无关）。
 */
export async function checkEvalGate(): Promise<EvalGateResult> {
  const { max, windowSec } = await getGateConfig()
  if (max <= 0) {
    return { allowed: true, active: 0, limit: 0 }
  }

  const rows = await query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM eval_auth_log WHERE createdAt > DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [windowSec],
  )
  const active = Number(rows[0]?.cnt ?? 0)

  return { allowed: active < max, active, limit: max }
}

/**
 * 评测闸门实时快照（监控专用，与 checkEvalGate 平行共存，类型契约在 #shared/types/adminMonitor）：
 * 无论 max 是否为 0 都真实计数——监控要看真实活跃数；
 * checkEvalGate 的 max<=0 短路不查库是评测鉴权热路径的快路径，不得合并。
 * 配置复用 getGateConfig 的 5min 缓存，sys_config 查询不被监控轮询放大。
 */
export async function getEvalGateSnapshot(): Promise<EvalGateSnapshot> {
  const { max, windowSec } = await getGateConfig()
  const rows = await query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM eval_auth_log WHERE createdAt > DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [windowSec],
  )
  return { active: Number(rows[0]?.cnt ?? 0), limit: max, windowSec }
}
