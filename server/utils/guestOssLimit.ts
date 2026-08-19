/**
 * 游客音频签名 URL 每日次数限流（server-only）
 *
 * 设计要点（仿 uploadLimitChecker）：
 * - 从 sys_config 读取 guest_daily_audio_limit（默认 20），运营可在管理端调整；
 *   读取经 configStore（缓存语义由 configStore 承载，模块内不再自建配置缓存）
 * - 计数经 rateStore 固窗（rl 域，键 = guestKey + 当日日期，TTL 24h，每日自然轮转）；
 *   Redis 可用时计数跨重启持久，不可用自动降级内存镜像（同固窗语义）
 */
import { getSysConfigKeys } from '#server/utils/configStore'
import { incrWindow } from '#server/utils/rateStore'

/** 默认每日限次（与 029 迁移 seed 值一致） */
const DEFAULT_DAILY_LIMIT = 20

/** sys_config 配置键 */
const CONFIG_KEY = 'guest_daily_audio_limit'

/** 日计数窗口（秒）：24h，与日期键配合自然轮转 */
const DAILY_WINDOW_SEC = 86_400

/** 获取当日日期字符串 YYYY-MM-DD（使用 Date.now() 以便测试 mock） */
function todayKey(): string {
  const d = new Date(Date.now())
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取 sys_config 中的每日限次配置（经 configStore；解析与默认值留在本模块） */
async function getDailyLimit(): Promise<number> {
  try {
    const map = await getSysConfigKeys([CONFIG_KEY])
    const parsed = parseInt(map.get(CONFIG_KEY) ?? '', 10)
    return isNaN(parsed) || parsed <= 0 ? DEFAULT_DAILY_LIMIT : parsed
  } catch {
    // 读取失败返回默认值，不阻塞业务
    return DEFAULT_DAILY_LIMIT
  }
}

/**
 * 检查游客今日音频获取次数是否超限。
 * 每次调用即计数 +1（不论后续签名是否成功），超限返回 false。
 */
export async function checkGuestAudioLimit(
  guestKey: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = await getDailyLimit()
  const { count } = await incrWindow(
    'rl',
    `guest-audio-key:${guestKey}:${todayKey()}`,
    DAILY_WINDOW_SEC,
  )
  if (count > limit) {
    return { allowed: false, remaining: 0 }
  }
  return { allowed: true, remaining: Math.max(0, limit - count) }
}
