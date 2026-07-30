import { markAllAsRead } from '#server/services/notice'
import { validateSuccess, validateError } from '#server/utils/validate'

/**
 * 用户端一键已读（把全部活跃公告标记为已读）
 * POST /api/notice/read-all
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  const affectedRows = await markAllAsRead(user.id)
  return validateSuccess({ affectedRows }, '已全部标记为已读')
})
