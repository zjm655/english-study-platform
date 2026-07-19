import { getUnitProgress } from '~/api/unit'
import type { UnitProgressDetail } from '#shared/types/unit'
import type { ResPayload } from '#shared/types/request'

export const useUnitProgress = () => {
  const cfg = createResCfg<number, UnitProgressDetail>({
    handle: getUnitProgress,
    success: '获取单元进度成功',
    clientFail: '获取单元进度失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })

  const { isLoading, execute } = useHandleRes(cfg)

  // 首页加载（走统一错误提示）
  const fetchUnitProgress = (unitId: number) => execute(unitId)

  // 加载更多：直接调 API，绕过 useHandleRes 防重复锁，避免每页弹 toast
  const isLoadingMore = ref(false)
  const loadMore = async (unitId: number, page: number): Promise<ResPayload<UnitProgressDetail>> => {
    if (isLoadingMore.value) {
      return { code: -2, message: '加载中', data: null as unknown as UnitProgressDetail }
    }
    isLoadingMore.value = true
    try {
      return await getUnitProgress(unitId, { page })
    } catch (err) {
      logger.warn('[useUnitProgress] 加载更多失败:', err)
      return { code: 0, message: String(err), data: null as unknown as UnitProgressDetail }
    } finally {
      isLoadingMore.value = false
    }
  }

  return { isLoading, isLoadingMore, fetchUnitProgress, loadMore, execute }
}
