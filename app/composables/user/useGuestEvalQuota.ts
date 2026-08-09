import { getGuestEvalQuota } from '~/api/guest'
import type { GuestEvalQuotaResult } from '~/api/guest'
import type { ResPayload } from '#shared/types/request'

/**
 * 游客评测配额查询 composable。
 * 不走 useHandleRes（避免 401/403 鉴权跳转踢游客到 /login），返回原始 ResPayload 由调用方静默处理。
 */
export const useGuestEvalQuota = () => {
  const isLoading = ref(false)
  const quota = ref<GuestEvalQuotaResult | null>(null)

  const fetchQuota = async (): Promise<ResPayload<GuestEvalQuotaResult> | null> => {
    isLoading.value = true
    try {
      const res = await getGuestEvalQuota()
      if (res?.code === 200 && res.data) {
        quota.value = res.data
      }
      return res
    } catch {
      return null
    } finally {
      isLoading.value = false
    }
  }

  return { isLoading, quota, fetchQuota }
}
