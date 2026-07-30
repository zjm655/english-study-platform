import { getNoticeDetailForUser } from '#server/services/notice'
import { validateSuccess, validateError } from '#server/utils/validate'

/**
 * 用户端公告详情（仅活跃公告可见，命中即标记已读）
 * GET /api/notice/:noticeId
 *
 * 路由匹配：Nitro 具名静态段（unread-count）优先于动态段（[noticeId]），
 * 此处数字校验兜底非法入参。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  const noticeId = Number(getRouterParam(event, 'noticeId'))
  if (!noticeId || isNaN(noticeId)) {
    return validateError('无效的公告ID')
  }

  const detail = await getNoticeDetailForUser(user.id, noticeId)
  if (!detail) return validateError('公告不存在或已下线', 404)

  return validateSuccess(detail, '获取公告详情成功')
})
