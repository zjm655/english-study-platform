import { getNlsQuotaInfo } from '#server/services/sttFiletrans'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

/**
 * 今日 NLS 免费额度信息（管理员上传页展示与超阈值提示）
 * GET /api/admin/material/nls-quota
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err

  const info = await getNlsQuotaInfo()
  return validateSuccess(info, '获取成功')
})