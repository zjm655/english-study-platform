import { getUnreadCount } from '#server/services/notice'
import { validateSuccess } from '#server/utils/validate'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'

/**
 * 用户端未读公告数（消息中心红点，登录用户 + 游客）
 * GET /api/notice/unread-count
 */
export default defineEventHandler(async (event) => {
  const userId = await resolveEffectiveUserId(event)
  if (!userId) return validateSuccess({ unreadCount: 0 }, '获取未读数成功')

  const unreadCount = await getUnreadCount(userId)
  return validateSuccess({ unreadCount }, '获取未读数成功')
})
