import { createNotice } from '#server/services/notice'
import { adminNoticeCreateSchema } from '#shared/schemas/notice'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理端创建公告（status 仅 draft/published；发布态未传 publishAt 取当前时间）
 * POST /api/admin/notice
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_NOTICES)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = adminNoticeCreateSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }

  const id = await createNotice(user.id, parsed.data)
  return validateSuccess({ id }, '创建成功')
})
