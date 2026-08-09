import { updateNotice } from '#server/services/notice'
import { adminNoticeUpdateSchema } from '#shared/schemas/notice'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理端更新公告（含状态转移校验，违规返回 400 与明确文案）
 * PUT /api/admin/notice/[noticeId]
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_NOTICES)
  if (err) return err
  const user = event.context.user

  const noticeId = Number(getRouterParam(event, 'noticeId'))
  if (!noticeId || isNaN(noticeId)) {
    return validateError('无效的公告ID')
  }

  const body = await readBody(event)
  const parsed = adminNoticeUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }

  // 状态转移违规 / 公告不存在等由 service 返回明确 code + message
  const result = await updateNotice(user.id, noticeId, parsed.data)
  if (result) return validateError(result.message, result.code)

  return validateSuccess(null, '修改成功')
})
