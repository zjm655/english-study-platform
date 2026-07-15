import { getSegmentDetail } from '~/api/unit'
import type { SegmentDetail } from '#shared/types/unit'

export const useSegmentDetail = () => {
  const cfg = createResCfg<number, SegmentDetail>({
    handle: getSegmentDetail,
    success: '获取片段详情成功',
    clientFail: '获取片段详情失败',
    serverFail: '服务器异常',
    error: '网络异常',
  })

  const { isLoading, execute } = useHandleRes(cfg)

  const fetchSegmentDetail = (segId: number) => execute(segId)

  return { isLoading, fetchSegmentDetail, execute }
}
