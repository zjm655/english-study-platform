import { markAnalyzeFail } from '~/api/recording'
import type { AnalyzeFailBody } from '~/api/recording/analyzeFail'
import type { Recording } from '#shared/types/recording'

export interface MarkAnalyzeFailInput {
  id: number
  /** 评测失败原因（SDK 结构化上报，P2-A） */
  error?: AnalyzeFailBody
}

export const useMarkAnalyzeFail = () => {
  const cfg = createResCfg<MarkAnalyzeFailInput, Recording>({
    handle: (input) => markAnalyzeFail(input.id, input.error),
    success: '已标记为分析失败',
    clientFail: '标记失败',
    serverFail: '服务器异常',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
