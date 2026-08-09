import { markAllAsRead } from '#server/services/notice'
import { validateSuccess, validateError } from '#server/utils/validate'
import { resolveAndEnsureGuestUserId } from '#server/services/guestEnsure'

/**
 * 用户端一键已读（把全部活跃公告标记为已读，登录用户 + 游客）
 * POST /api/notice/read-all
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.user?.id ?? (await resolveAndEnsureGuestUserId(event))
  if (!userId) return validateError('未登录', 401)

  const affectedRows = await markAllAsRead(userId)
  return validateSuccess({ affectedRows }, '已全部标记为已读')
})
