import type { Recording } from '#shared/types/recording'
import { getEvaluationAuth } from '~/api/evaluation/auth'
import { useSpeechEvaluation } from '~/composables/evaluation/useSpeechEvaluation'
import type { EvaluationResult } from '~/composables/evaluation/useSpeechEvaluation'
import { useAnalyzeRecording, useMarkAnalyzeFail } from '~/composables/recording'

/** 评测鉴权结果（warrantId 供 SDK initEngine / startRealtime 使用） */
export interface EvaluationAuth {
  warrantId: string
  applicationId: string
}

/** 已上传录音的上下文（保存评测结果 / 构造回退记录共用） */
export interface RecordingContext {
  recordingId: number
  audioPath: string
  duration: number
  createdAt: string
  segmentId: number
  phase: 3 | 4
  userId: number
}

/** 保存评测结果入参 = 录音上下文 + SDK 评测结果 */
export interface SaveEvaluationParams extends RecordingContext {
  result: EvaluationResult
}

/** 离线评测（配音分析 / 重试）入参 */
export interface OfflineEvaluationParams extends RecordingContext {
  /** 取音频 blob：配音直接返回本地 blob，重试从 OSS 拉取；失败抛错由流程统一兜底 */
  getBlob: () => Promise<Blob>
  refText: string
}

/**
 * 评测流程统一出参。
 * - success=true：recording 为已保存并回填 audioPath 的录音；
 * - success=false：recording 为「标记失败」后的录音（便于加入历史列表供重试），errorMessage 供调用方 toast。
 */
export interface EvaluationOutcome {
  success: boolean
  recording: Recording | null
  errorMessage: string | null
}

/**
 * 评测流程统一封装（消除 DubbingPractice / ShadowReading / useRetryAnalyze 三处重复）。
 *
 * 暴露三个层级的能力，按调用方需要组合：
 * - `resolveAuth()`：仅鉴权（三处共用；实时评测需自行 initEngine + startRealtime）。
 * - `saveEvaluation(params)`：公共尾段——保存结果 + 成功回填 audioPath + 失败标记与回退（三处共用）。
 * - `runOffline(params)`：离线全流程——取 blob → 鉴权 → initEngine → 评测 → saveEvaluation（配音分析 / 重试共用）。
 *
 * 内部持有独立的 useSpeechEvaluation 实例（仅 runOffline 使用），与父组件各自的实例互不干扰。
 */
export const useEvaluationPipeline = () => {
  const {
    initEngine,
    analyzeRecording: evalAnalyzeRecording,
    destroy: destroyEngine,
  } = useSpeechEvaluation()
  const { execute: analyzeRecording } = useAnalyzeRecording()
  const { execute: markAnalyzeFail } = useMarkAnalyzeFail()

  const isLoading = ref(false)

  /** phase 编号 → 字符串标识（游客配额检查用） */
  function phaseToString(phase: 3 | 4): 'dubbing' | 'shadow' {
    return phase === 4 ? 'shadow' : 'dubbing'
  }

  /** 评测鉴权：调用 getEvaluationAuth 并校验，失败抛错。phase 供游客配额检查。 */
  async function resolveAuth(phase?: 3 | 4): Promise<EvaluationAuth> {
    const authRes = await getEvaluationAuth(phase ? phaseToString(phase) : undefined)
    if (authRes?.code !== 200 || !authRes.data) {
      throw new Error(authRes?.message || '获取评测授权失败')
    }
    return { warrantId: authRes.data.warrantId, applicationId: authRes.data.applicationId }
  }

  /** 本地构造「分析失败」的回退 Recording（后端 markAnalyzeFail 不可用时兜底）。 */
  function buildFailedRecording(ctx: RecordingContext): Recording {
    return {
      id: ctx.recordingId,
      userId: ctx.userId,
      segmentId: ctx.segmentId,
      phase: ctx.phase,
      audioPath: ctx.audioPath,
      score: null,
      analyzeStatus: 'failed',
      feedback: null,
      recognizedText: null,
      wordScores: null,
      rawResult: null,
      duration: ctx.duration,
      createdAt: ctx.createdAt,
    }
  }

  /** 标记录音分析失败：优先用后端返回的 Recording，异常/非 200 时回退本地构造。 */
  async function markFailed(ctx: RecordingContext): Promise<Recording> {
    try {
      const failRes = await markAnalyzeFail({ id: ctx.recordingId })
      if (failRes?.code === 200 && failRes.data) {
        return failRes.data
      }
    } catch {
      // 静默吞错，走本地回退构造
    }
    return buildFailedRecording(ctx)
  }

  /** 公共尾段：保存评测结果；成功回填 audioPath，失败标记 + 回退。不抛错，统一返回 outcome。 */
  async function saveEvaluation(params: SaveEvaluationParams): Promise<EvaluationOutcome> {
    try {
      const saveRes = await analyzeRecording({
        id: params.recordingId,
        result: {
          score: params.result.score,
          wordScores: params.result.wordScores,
          rawResult: params.result.rawResult,
        },
      })
      if (saveRes?.code === 200 && saveRes.data) {
        // analyze 接口返回的 audioPath 为 recording 表原始列（空），用上传接口的已签名地址回填，保证列表可即时播放
        return {
          success: true,
          recording: { ...saveRes.data, audioPath: params.audioPath },
          errorMessage: null,
        }
      }
      throw new Error(saveRes?.message || '保存评测结果失败')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '保存评测结果失败'
      logger.error('[EvaluationPipeline] 保存评测结果失败:', err)
      const recording = await markFailed(params)
      return { success: false, recording, errorMessage }
    }
  }

  /** 离线评测全流程：取 blob → 鉴权 → initEngine → 评测 → saveEvaluation。任一步失败均标记 + 回退。 */
  async function runOffline(params: OfflineEvaluationParams): Promise<EvaluationOutcome> {
    isLoading.value = true
    // 先销毁旧引擎（initEngine 有缓存，多次评测需从干净状态重新初始化）
    destroyEngine()
    try {
      const blob = await params.getBlob()
      const { warrantId, applicationId } = await resolveAuth(params.phase)
      await initEngine(applicationId, String(params.userId), warrantId)
      const result = await evalAnalyzeRecording(blob, params.refText)
      return await saveEvaluation({ ...params, result })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '评测失败'
      logger.error('[EvaluationPipeline] 离线评测失败:', err)
      const recording = await markFailed(params)
      return { success: false, recording, errorMessage }
    } finally {
      isLoading.value = false
      destroyEngine()
    }
  }

  return { isLoading, resolveAuth, saveEvaluation, runOffline, buildFailedRecording }
}
