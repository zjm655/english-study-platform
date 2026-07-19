import { analyzeRecording } from '~/api/recording'
import type { Recording } from '#shared/types/recording'

export interface AnalyzeRecordingInput {
  id: number
  sdkResult: Record<string, unknown>
}

export const useAnalyzeRecording = () => {
  const cfg = createResCfg<AnalyzeRecordingInput, Recording>({
    handle: (input) => analyzeRecording(input.id, input.sdkResult),
    success: '分析完成',
    clientFail: '分析失败，请重试',
    serverFail: '服务器异常，分析失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
