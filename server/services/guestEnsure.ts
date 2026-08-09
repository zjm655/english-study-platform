// server/services/guestEnsure.ts
// 解析游客身份并确保 user 行存在（懒实体化），用于写端点（progress/checkin）。
//
// 与 guestUserId.ts 的 resolveEffectiveUserId 区别：
// - resolveEffectiveUserId：只读查询，游客未实体化返回 null
// - resolveAndEnsureGuestUserId：写操作前调用，游客未实体化时自动 INSERT user 行
import type { H3Event } from 'h3'
import { readGuestKey } from '#server/utils/guest'
import { withTransaction } from '#server/utils/db'
import { ensureGuestUser } from './guestUser'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'

/**
 * 解析当前请求的有效 user_id，游客未实体化时自动懒实体化。
 * 返回 null 表示无法识别身份（无登录态 + 无/坏 guest_token）。
 */
export async function resolveAndEnsureGuestUserId(event: H3Event): Promise<number | null> {
  // 优先走只读解析（登录用户或已实体化游客）
  const existing = await resolveEffectiveUserId(event)
  if (existing) return existing

  // 游客未实体化：读 guest_key → 事务内懒实体化
  const guestKey = await readGuestKey(event)
  if (!guestKey) return null

  try {
    return await withTransaction(async (conn) => {
      const ensured = await ensureGuestUser(conn, guestKey)
      if (ensured.conflict) return null // 残留已合并 cookie
      return ensured.userId
    })
  } catch {
    return null
  }
}
