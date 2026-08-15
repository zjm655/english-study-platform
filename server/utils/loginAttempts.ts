import { logAlertEvent } from '#server/utils/alertEventLog'
import { fileLog } from '#server/utils/fileLogger'

// server/utils/loginAttempts.ts
// 登录连续失败计数（进程内内存态，镜像 rateLimiter 的 windowMap 模式）。
//
// 用途：登录密码连错达阈值后，在 login handler 中强制要求图形验证码。
// 单实例语义：计数存于模块级 Map，进程重启即清零、不跨实例共享，与现有限流一致
// （AGENTS.md 已记录单机内存态约束）。

/** 达到该阈值后要求图形验证码 */
export const CAPTCHA_THRESHOLD = 3

/** 最大跟踪账号数（防止内存无限增长） */
const MAX_ENTRIES = 10_000
/** 计数存活时长：超过后视为过期清零（避免历史失败长期要求验证码） */
const ENTRY_TTL_MS = 30 * 60_000
/** 定时清理间隔（每 5 分钟清理一次过期条目） */
const CLEANUP_INTERVAL_MS = 5 * 60_000

interface AttemptEntry {
  /** 连续失败次数 */
  count: number
  /** 最后一次失败时间戳 */
  ts: number
}

/** account -> 连续失败记录 */
const failMap = new Map<string, AttemptEntry>()

/** 达到容量上限时淘汰最旧插入的键（FIFO 近似 LRU） */
function evictOldestIfFull(): void {
  if (failMap.size >= MAX_ENTRIES) {
    const oldestKey = failMap.keys().next().value
    if (oldestKey !== undefined) failMap.delete(oldestKey)
  }
}

/** 读取指定账号当前连续失败次数（过期条目视为 0 并清除） */
export function getFailCount(account: string): number {
  const entry = failMap.get(account)
  if (!entry) return 0
  if (Date.now() - entry.ts > ENTRY_TTL_MS) {
    failMap.delete(account)
    return 0
  }
  return entry.count
}

/** 记录一次登录失败：计数 +1，刷新时间戳；达到验证码阈值时写安全事件（P2：审计留痕） */
export function recordFail(account: string): void {
  const entry = failMap.get(account)
  if (!entry) {
    evictOldestIfFull()
    failMap.set(account, { count: 1, ts: Date.now() })
  } else {
    entry.count += 1
    entry.ts = Date.now()
  }
  if (entry && entry.count >= CAPTCHA_THRESHOLD) {
    fileLog('auth', 'warn', '[login] 登录失败达到验证码阈值', {
      account,
      count: entry.count,
    })
    void logAlertEvent({
      source: 'security',
      level: 'warn',
      code: 'login_brute_force',
      message: `账号登录失败 ${entry.count} 次，触发验证码`,
      context: { account, count: entry.count },
    })
  }
}

/** 登录成功：清零该账号的失败计数 */
export function resetFail(account: string): void {
  failMap.delete(account)
}

/** 定时清理：删除所有过期条目 */
function cleanup() {
  const now = Date.now()
  for (const [account, entry] of failMap.entries()) {
    if (now - entry.ts > ENTRY_TTL_MS) failMap.delete(account)
  }
}

// 启动定时清理
if (typeof setInterval !== 'undefined') {
  setInterval(cleanup, CLEANUP_INTERVAL_MS)
}
