import { getUnreadCount } from '#server/services/notice'
import { validateSuccess, validateError } from '#server/utils/validate'

/**
 * 用户端未读公告数（消息中心红点）
 * GET /api/notice/unread-count
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  const unreadCount = await getUnreadCount(user.id)
  return validateSuccess({ unreadCount }, '获取未读数成功')
})
