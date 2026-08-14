import { getAdminNlsQuota } from '~/api/admin/nlsQuota'
import type { NlsQuotaInfo } from '#shared/types/nlsQuota'

/**
 * 今日 NLS 免费额度信息（管理员上传页展示与超阈值提示）。
 * 只读接口，页面在 onMounted 静默拉取（execute 传 silent 跳过常规提示）。
 */
export const useAdminNlsQuota = () => {
  const cfg = createResCfg<undefined, NlsQuotaInfo>({
    handle: () => getAdminNlsQuota(),
    success: '获取 NLS 免费额度成功',
    clientFail: '获取 NLS 免费额度失败',
    serverFail: '服务器异常，获取 NLS 免费额度失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}