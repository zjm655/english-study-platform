import { logAlertEvent } from '#server/utils/alertEventLog'
import { fileLog } from '#server/utils/fileLogger'
import { incrWindow, getCount, resetKey } from '#server/utils/rateStore'

// server/utils/loginAttempts.ts
// 登录连续失败计数（P2：计数经 rateStore 外置——Redis 可用时跨重启持久、多实例一致；
// 不可用自动降级内存固窗，功能不中断）。
//
// 用途：登录密码连错达阈值后，在 login handler 中强制要求图形验证码。
// 窗口语义：fail 域 + refreshTtl=true——每次失败刷新过期，保持「最后一次失败后 30min 清零」现状语义。

/** 达到该阈值后要求图形验证码 */
export const CAPTCHA_THRESHOLD = 3

/** 失败计数窗口（秒）：最后一次失败后 30 分钟清零（refreshTtl 每次失败刷新过期） */
const FAIL_WINDOW_SEC = 30 * 60

/** 读取指定账号当前连续失败次数（窗口过期视为 0） */
export async function getFailCount(account: string): Promise<number> {
  return getCount('fail', account)
}

/** 记录一次登录失败：计数 +1 并刷新窗口；达到验证码阈值时写安全事件（P2：审计留痕） */
export async function recordFail(account: string): Promise<void> {
  const { count } = await incrWindow('fail', account, FAIL_WINDOW_SEC, { refreshTtl: true })
  if (count >= CAPTCHA_THRESHOLD) {
    fileLog('auth', 'warn', '[login] 登录失败达到验证码阈值', {
      account,
      count,
    })
    void logAlertEvent({
      source: 'security',
      level: 'warn',
      code: 'login_brute_force',
      message: `账号登录失败 ${count} 次，触发验证码`,
      context: { account, count },
    })
  }
}

/** 登录成功：清零该账号的失败计数（P2 review 补记 info 留痕） */
export async function resetFail(account: string): Promise<void> {
  await resetKey('fail', account)
  fileLog('auth', 'info', '[login] 登录成功，已清零失败计数', { account })
}
