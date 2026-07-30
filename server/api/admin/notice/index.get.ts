import { getNoticesForAdmin } from '#server/services/notice'
import { adminNoticeListSchema, validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理端公告列表（全部状态 + 标题搜索，附创建者昵称与阅读数）
 * GET /api/admin/notice
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_NOTICES)
  if (err) return err

  const parsed = adminNoticeListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, status, keyword } = parsed.data

  const result = await getNoticesForAdmin(keyword, status, page, pageSize)
  return validateSuccess(result, '获取公告列表成功')
})
