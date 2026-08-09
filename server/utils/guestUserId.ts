// server/utils/guestUserId.ts
// 解析请求中的有效 user_id：登录用户走 event.context.user，游客走 guest_token → guest_key → user.id。
//
// 设计要点：
// - 优先 event.context.user?.id（登录用户，auth 中间件已挂载）
// - 否则读 guest_token cookie → verifyGuestToken → gk → 查 user 表
// - 游客未实体化（无 user 行）→ 返回 null（调用方决定是否懒实体化）
// - 查库失败 → null（静默降级，不阻断业务）
import { readGuestKey } from '#server/utils/guest'
import { query } from '#server/utils/db'

/**
 * 解析当前请求的有效 user_id（登录用户或已实体化游客）。
 * 返回 null 表示无法识别身份（无登录态 + 无/坏 guest_token + 游客未实体化）。
 */
export async function resolveEffectiveUserId(event: H3Event): Promise<number | null> {
  // 登录用户：中间件已挂载
  const loggedInId = event.context.user?.id
  if (loggedInId) return loggedInId

  // 游客：guest_token → guest_key → user.id
  const guestKey = await readGuestKey(event)
  if (!guestKey) return null

  try {
    const rows = await query<{ id: number }>(
      'SELECT id FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL LIMIT 1',
      [guestKey],
    )
    return rows.length > 0 ? rows[0]!.id : null
  } catch {
    return null
  }
}
