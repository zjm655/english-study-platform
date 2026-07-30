import { getActiveNotices } from '#server/services/notice'
import { noticeListSchema, validateSuccess, validateError } from '#server/utils/validate'

/**
 * 用户端公告列表（仅活跃公告，服务端分页 + 置顶优先，附带 isRead）
 * GET /api/notice?page&pageSize
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) return validateError('未登录', 401)

  const parsed = noticeListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize } = parsed.data

  const result = await getActiveNotices(user.id, page, pageSize)
  return validateSuccess(result, '获取公告列表成功')
})
