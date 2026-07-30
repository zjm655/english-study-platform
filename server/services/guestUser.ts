// server/services/guestUser.ts
// 游客懒实体化：仅当游客产生首条有价值行为（一期=正数学习时长上报）时才真正 INSERT user 行。
import type { PoolConnection } from 'mysql2/promise'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { query } from '#server/utils/db'

/** 游客单日学习时长上限默认值（秒，=4h）：sys_config 缺失/非法时兑底 */
const DEFAULT_GUEST_DAILY_CAP = 14400
const CACHE_TTL = 5 * 60 * 1000
let cachedCap: { value: number; expireAt: number } | null = null

/**
 * 读游客单日学习时长上限（sys_config 带 5min TTL 缓存，仿 quotaChecker 模式）。
 * 查库失败/非法值兑底默认，不阻断上报。
 */
export async function getGuestDailyStudyCap(): Promise<number> {
  if (cachedCap && Date.now() < cachedCap.expireAt) return cachedCap.value
  try {
    const rows = await query<{ config_value: string }>(
      "SELECT config_value FROM sys_config WHERE config_key = 'guest_daily_study_cap'",
    )
    const raw = Number(rows[0]?.config_value)
    const value = !Number.isFinite(raw) || raw <= 0 ? DEFAULT_GUEST_DAILY_CAP : Math.floor(raw)
    cachedCap = { value, expireAt: Date.now() + CACHE_TTL }
    return value
  } catch {
    return DEFAULT_GUEST_DAILY_CAP
  }
}

export interface EnsureGuestResult {
  /** true=guest_key 对应行已被合并（残留 cookie），调用方应换发新 key；此时 userId 无意义 */
  conflict: boolean
  /** conflict=false 时有效：游客 user 行 id */
  userId: number
}

/**
 * 确保游客 user 行存在并返回其 id（事务内调用）。
 * - 已存在且未合并 → 返回该行 id
 * - 已存在但已合并（merged_into_user_id 非空，残留 cookie）→ { conflict: true }
 * - 不存在 → INSERT（ON DUPLICATE KEY 依 uk_guest_key 收敛并发双请求到同一行）+ 建 checkin_stats
 */
export async function ensureGuestUser(
  conn: PoolConnection,
  guestKey: string,
): Promise<EnsureGuestResult> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT id, merged_into_user_id FROM user WHERE guest_key = ?',
    [guestKey],
  )
  const existing = rows[0] as { id: number; merged_into_user_id: number | null } | undefined
  if (existing) {
    if (existing.merged_into_user_id != null) return { conflict: true, userId: 0 }
    return { conflict: false, userId: existing.id }
  }

  // 懒实体化：ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id) 使并发双 INSERT 收敛到同一行
  const [ins] = await conn.execute<ResultSetHeader>(
    `INSERT INTO user (account, passwordHash, nickname, is_guest, guest_key)
     VALUES (NULL, NULL, '游客', 1, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [guestKey],
  )
  const userId = ins.insertId
  await conn.execute('INSERT IGNORE INTO user_checkin_stats (user_id) VALUES (?)', [userId])
  return { conflict: false, userId }
}
