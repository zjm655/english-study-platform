import type { Recording } from '#shared/types/recording'
import { useEvaluationPipeline } from '~/composables/evaluation/useEvaluationPipeline'
import { useUserStore } from '~/store/useUserStore'

export interface RetryAnalyzeInput {
  /** 要重试的录音对象 */
  recording: Recording
  /** 参考文本（评测用） */
  refText: string
}

/**
 * 重试分析失败录音的 composable
 *
 * 适用场景：录音已上传但评测分析失败（限流、网络异常等），
 * 此时历史列表中该录音 analyzeStatus='failed'。本 composable 从
 * 历史 OSS URL 重新拉取音频 blob，再走一次完整评测流程并保存结果。
 *
 * 实现：委托 useEvaluationPipeline.runOffline（与配音分析共用离线全流程：
 * 取 blob → 鉴权 → initEngine → 评测 → 保存/失败回退），此处仅做入参校验与
 * blob 来源（从 OSS 拉取）注入，出参对齐原「Recording | null」语义。
 */
export const useRetryAnalyze = () => {
  const { isLoading, runOffline } = useEvaluationPipeline()
  const userStore = useUserStore()

  async function execute(input: RetryAnalyzeInput): Promise<Recording | null> {
    const { recording, refText } = input
    const userId = userStore.user?.id
    if (!userId) {
      toastError('用户信息异常，请重新登录')
      return null
    }
    if (!recording.audioPath) {
      toastError('录音文件不存在，无法重试')
      return null
    }
    const audioPath = recording.audioPath

    const outcome = await runOffline({
      getBlob: async () => {
        const blobRes = await fetch(audioPath)
        if (!blobRes.ok) throw new Error('录音文件获取失败')
        return blobRes.blob()
      },
      refText,
      userId,
      recordingId: recording.id,
      audioPath,
      duration: recording.duration ?? 0,
      createdAt: recording.createdAt,
      segmentId: recording.segmentId,
      phase: recording.phase === 4 ? 4 : 3,
    })

    if (!outcome.success) {
      toastError(outcome.errorMessage || '重试分析失败')
      return null
    }
    return outcome.recording
  }

  return { isLoading, execute }
}
