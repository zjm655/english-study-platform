import { deleteNotice } from '#server/services/notice'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 管理端删除公告（软删除：置 deleted_at）
 * DELETE /api/admin/notice/[noticeId]
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

  const result = await deleteNotice(user.id, noticeId)
  if (result) return validateError(result.message, result.code)

  return validateSuccess(null, '删除成功')
})
