import type { Recording } from '#shared/types/recording'
import { getEvaluationAuth } from '~/api/evaluation/auth'
import { toastError } from '~/utils/popup'
import { useSpeechEvaluation } from '~/composables/evaluation/useSpeechEvaluation'
import { useUserStore } from '~/store/useUserStore'
import { useAnalyzeRecording, useMarkAnalyzeFail } from '~/composables/recording'

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
 * 设计要点：
 * - 内部持有一个独立的 useSpeechEvaluation 实例。useSpeechEvaluation 的
 *   内部状态（engine/initPromise/pendingResolve 等）均为函数内 let 变量，
 *   每次调用 useSpeechEvaluation() 都创建独立闭包，因此与父组件
 *   DubbingPractice.vue / ShadowReading.vue 各自持有的实例互不干扰。
 * - 不走 createResCfg + useHandleRes 模式，因为内部含多步流程（拉 blob、
 *   鉴权、initEngine、评测、保存），直接返回 Recording | null 更清晰。
 * - onBeforeUnmount 时 useSpeechEvaluation 内部已注册 destroy，无需在此
 *   再注册；但每次 execute 结束后都主动 destroyEngine() 释放引擎，避免
 *   长期占用 WebSocket。
 */
export const useRetryAnalyze = () => {
  const {
    initEngine,
    analyzeRecording: evalAnalyzeRecording,
    destroy: destroyEngine,
  } = useSpeechEvaluation()
  const { execute: analyzeRecording } = useAnalyzeRecording()
  const { execute: markAnalyzeFail } = useMarkAnalyzeFail()
  const userStore = useUserStore()

  const isLoading = ref(false)

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

    isLoading.value = true
    // 清理上一次的引擎（如果存在），保证 initEngine 从干净状态开始
    destroyEngine()

    try {
      // 1. 从 OSS 拉取音频 blob
      const blobRes = await fetch(recording.audioPath)
      if (!blobRes.ok) throw new Error('录音文件获取失败')
      const blob = await blobRes.blob()

      // 2. 评测鉴权
      const authRes = await getEvaluationAuth()
      if (authRes?.code !== 200 || !authRes.data) {
        throw new Error(authRes?.message || '获取评测授权失败')
      }
      const { warrantId, applicationId } = authRes.data

      // 3. 初始化引擎 + 评测
      await initEngine(applicationId, String(userId), warrantId)
      const result = await evalAnalyzeRecording(blob, refText)

      // 4. 保存评测结果到后端
      const saveRes = await analyzeRecording({
        id: recording.id,
        result: {
          score: result.score,
          wordScores: result.wordScores,
          rawResult: result.rawResult,
        },
      })
      if (saveRes?.code === 200 && saveRes.data) {
        // 保留原 audioPath（后端 analyze 接口返回的 data 中 audioPath 可能为空，
        // 因为 recording 表原始 audioPath 列不会被该接口修改）
        return { ...saveRes.data, audioPath: recording.audioPath }
      }
      throw new Error(saveRes?.message || '保存评测结果失败')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重试分析失败'
      toastError(msg)
      logger.error('[RetryAnalyze] 重试失败:', err)
      // 标记为失败（可能本来就是 failed，但保险起见再标一次）
      try {
        await markAnalyzeFail({ id: recording.id })
      } catch {
        // 静默吞错，不影响主流程错误展示
      }
      return null
    } finally {
      isLoading.value = false
      destroyEngine()
    }
  }

  return { isLoading, execute }
}
