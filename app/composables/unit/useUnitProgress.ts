import { getUnitProgress } from '~/api/unit'
import type { UnitProgressDetail } from '#shared/types/unit'

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

  // 加载更多：使用独立 useHandleRes 实例，拥有独立防重锁（与首屏加载互不阻塞）；
  // silent 模式跳过每页成功日志刷屏，但**保留** 401/403 鉴权跳转与错误归一化，
  // 避免分页时鉴权失效被静默吞掉。
  const moreCfg = createResCfg<{ unitId: number; page: number }, UnitProgressDetail>({
    handle: ({ unitId, page }) => getUnitProgress(unitId, { page }),
    success: '获取单元进度成功',
    clientFail: '获取单元进度失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  const { isLoading: isLoadingMore, execute: executeMore } = useHandleRes(moreCfg)
  const loadMore = (unitId: number, page: number) => executeMore({ unitId, page }, { silent: true })

  return { isLoading, isLoadingMore, fetchUnitProgress, loadMore, execute }
}
