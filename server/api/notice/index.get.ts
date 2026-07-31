import { getActiveNotices } from '#server/services/notice'
import { noticeListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { resolveEffectiveUserId } from '#server/utils/guestUserId'

/**
 * 用户端公告列表（仅活跃公告，服务端分页 + 置顶优先，附带 isRead，登录用户 + 游客）
 * GET /api/notice?page&pageSize
 */
export default defineEventHandler(async (event) => {
  const userId = await resolveEffectiveUserId(event)
  if (!userId) return validateError('未登录', 401)

  const parsed = noticeListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize } = parsed.data

  const result = await getActiveNotices(userId, page, pageSize)
  return validateSuccess(result, '获取公告列表成功')
})
