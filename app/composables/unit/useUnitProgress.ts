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

  const fetchUnitProgress = (unitId: number) => execute(unitId)

  return { isLoading, fetchUnitProgress, execute }
}
