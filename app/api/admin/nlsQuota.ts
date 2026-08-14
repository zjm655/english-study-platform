import { adminNlsQuotaPath } from '~/api/paths'
import type { NlsQuotaInfo } from '#shared/types/nlsQuota'

/**
 * 今日 NLS 免费额度信息（管理员上传页展示与超阈值提示）
 * GET /api/admin/material/nls-quota
 */
export const getAdminNlsQuota = () => {
  return request<NlsQuotaInfo>(adminNlsQuotaPath, { method: 'GET' })
}