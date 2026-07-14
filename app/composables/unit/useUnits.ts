import { getUnits } from '~/api/unit'
import type { UnitWithProgress } from '#shared/types/unit'

export const useUnits = () => {
  const cfg = createResCfg<number | undefined, UnitWithProgress[]>({
    handle: getUnits,
    success: '获取单元列表成功',
    clientFail: '获取单元列表失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })
  return useHandleRes(cfg)
}
