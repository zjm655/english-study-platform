import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Recording, WordScore } from '#shared/types/recording'
import type { EvaluationResult } from '../useSpeechEvaluation'
import { useEvaluationPipeline } from '../useEvaluationPipeline'

// logger 为 Nuxt 自动导入，测试环境需 stub
vi.stubGlobal('logger', { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() })

// mock 评测鉴权 API
const mockGetEvaluationAuth = vi.fn()
vi.mock('~/api/evaluation/auth', () => ({
  getEvaluationAuth: () => mockGetEvaluationAuth(),
}))

// mock 评测 SDK（useSpeechEvaluation）
const mockInitEngine = vi.fn()
const mockEvalAnalyze = vi.fn()
const mockDestroy = vi.fn()
vi.mock('~/composables/evaluation/useSpeechEvaluation', () => ({
  useSpeechEvaluation: () => ({
    initEngine: mockInitEngine,
    analyzeRecording: mockEvalAnalyze,
    destroy: mockDestroy,
  }),
}))

// mock 保存 / 标记失败 composable
const mockAnalyzeExecute = vi.fn()
const mockMarkExecute = vi.fn()
vi.mock('~/composables/recording', () => ({
  useAnalyzeRecording: () => ({ execute: mockAnalyzeExecute }),
  useMarkAnalyzeFail: () => ({ execute: mockMarkExecute }),
}))

const WORD_SCORES: WordScore[] = [{ word: 'hi', score: 90, status: 'correct' }]
const EVAL_RESULT: EvaluationResult = { score: 88, wordScores: WORD_SCORES, rawResult: '{"a":1}' }

function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 1,
    userId: 7,
    segmentId: 3,
    phase: 3,
    duration: 12,
    score: 88,
    audioPath: '', // 后端 analyze 返回的原始列通常为空，靠 pipeline 回填
    feedback: null,
    recognizedText: null,
    wordScores: WORD_SCORES,
    rawResult: '{"a":1}',
    createdAt: '2025-01-01T00:00:00.000Z',
    analyzeStatus: 'success',
    analyzeError: null,
    ...overrides,
  }
}

const OFFLINE_CTX = {
  refText: 'hello world',
  userId: 7,
  recordingId: 1,
  audioPath: 'https://oss.example.com/rec/1.ogg',
  duration: 12,
  createdAt: '2025-01-01T00:00:00.000Z',
  segmentId: 3,
  phase: 3 as const,
}

describe('useEvaluationPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEvaluationAuth.mockResolvedValue({
      code: 200,
      data: { warrantId: 'w-1', applicationId: 'app-1' },
      message: 'ok',
    })
    mockInitEngine.mockResolvedValue(undefined)
    mockEvalAnalyze.mockResolvedValue(EVAL_RESULT)
  })

  describe('resolveAuth', () => {
    it('成功返回 warrantId / applicationId', async () => {
      const { resolveAuth } = useEvaluationPipeline()
      await expect(resolveAuth()).resolves.toEqual({ warrantId: 'w-1', applicationId: 'app-1' })
    })

    it('鉴权非 200 时抛错', async () => {
      mockGetEvaluationAuth.mockResolvedValueOnce({ code: 401, data: null, message: '未授权' })
      const { resolveAuth } = useEvaluationPipeline()
      await expect(resolveAuth()).rejects.toThrow('未授权')
    })
  })

  describe('runOffline 成功路径', () => {
    it('保存成功并用传入 audioPath 回填', async () => {
      mockAnalyzeExecute.mockResolvedValueOnce({ code: 200, data: makeRecording(), message: 'ok' })
      const { runOffline } = useEvaluationPipeline()
      const outcome = await runOffline({
        ...OFFLINE_CTX,
        getBlob: () => Promise.resolve(new Blob(['x'])),
      })

      expect(outcome.success).toBe(true)
      expect(outcome.errorMessage).toBeNull()
      expect(outcome.recording).not.toBeNull()
      // audioPath 被回填为入参地址（后端返回为空）
      expect(outcome.recording!.audioPath).toBe(OFFLINE_CTX.audioPath)
      expect(outcome.recording!.score).toBe(88)
      // 保存成功不应触发 markAnalyzeFail
      expect(mockMarkExecute).not.toHaveBeenCalled()
      // 引擎在开始与结束各销毁一次
      expect(mockDestroy).toHaveBeenCalledTimes(2)
    })
  })

  describe('runOffline 失败路径', () => {
    it('评测异常 → 标记失败并返回失败录音 + 错误信息', async () => {
      mockEvalAnalyze.mockRejectedValueOnce(new Error('SDK 崩溃'))
      mockMarkExecute.mockResolvedValueOnce({
        code: 200,
        data: makeRecording({ analyzeStatus: 'failed', score: null }),
        message: 'ok',
      })
      const { runOffline } = useEvaluationPipeline()
      const outcome = await runOffline({
        ...OFFLINE_CTX,
        getBlob: () => Promise.resolve(new Blob(['x'])),
      })

      expect(outcome.success).toBe(false)
      expect(outcome.errorMessage).toBe('SDK 崩溃')
      expect(outcome.recording!.analyzeStatus).toBe('failed')
      // P2-A：失败原因结构化上报（errorCode=eval_offline_failed）
      expect(mockMarkExecute).toHaveBeenCalledWith({
        id: OFFLINE_CTX.recordingId,
        error: { errorCode: 'eval_offline_failed', errorMessage: 'SDK 崩溃' },
      })
      // 保存不应被调用（评测阶段已失败）
      expect(mockAnalyzeExecute).not.toHaveBeenCalled()
    })

    it('取音频 blob 失败（重试拉流场景）→ 走失败回退', async () => {
      mockMarkExecute.mockResolvedValueOnce({ code: 500, data: null, message: '标记失败' })
      const { runOffline } = useEvaluationPipeline()
      const outcome = await runOffline({
        ...OFFLINE_CTX,
        getBlob: () => Promise.reject(new Error('录音文件获取失败')),
      })

      expect(outcome.success).toBe(false)
      expect(outcome.errorMessage).toBe('录音文件获取失败')
      // markAnalyzeFail 也非 200 时，回退本地构造：id/audioPath 对齐入参，状态 failed
      expect(outcome.recording).toEqual(
        expect.objectContaining({
          id: OFFLINE_CTX.recordingId,
          audioPath: OFFLINE_CTX.audioPath,
          analyzeStatus: 'failed',
          score: null,
        }),
      )
    })
  })

  describe('saveEvaluation（实时评测尾段共用）', () => {
    const SAVE_CTX = {
      recordingId: 9,
      audioPath: 'https://oss.example.com/rec/9.webm',
      duration: 20,
      createdAt: '2025-02-02T00:00:00.000Z',
      segmentId: 5,
      phase: 4 as const,
      userId: 7,
      result: EVAL_RESULT,
    }

    it('保存成功回填 audioPath', async () => {
      mockAnalyzeExecute.mockResolvedValueOnce({
        code: 200,
        data: makeRecording({ id: 9, phase: 4 }),
        message: 'ok',
      })
      const { saveEvaluation } = useEvaluationPipeline()
      const outcome = await saveEvaluation(SAVE_CTX)

      expect(outcome.success).toBe(true)
      expect(outcome.recording!.audioPath).toBe(SAVE_CTX.audioPath)
      expect(mockMarkExecute).not.toHaveBeenCalled()
    })

    it('保存非 200 → 标记失败；markFail 也失败则本地回退构造', async () => {
      mockAnalyzeExecute.mockResolvedValueOnce({ code: 500, data: null, message: '服务器异常' })
      mockMarkExecute.mockResolvedValueOnce({ code: 500, data: null, message: '标记失败' })
      const { saveEvaluation } = useEvaluationPipeline()
      const outcome = await saveEvaluation(SAVE_CTX)

      expect(outcome.success).toBe(false)
      expect(outcome.errorMessage).toBe('服务器异常')
      // P2-A：保存失败结构化上报（errorCode=eval_save_failed）
      expect(mockMarkExecute).toHaveBeenCalledWith({
        id: SAVE_CTX.recordingId,
        error: { errorCode: 'eval_save_failed', errorMessage: '服务器异常' },
      })
      expect(outcome.recording).toEqual(
        expect.objectContaining({
          id: SAVE_CTX.recordingId,
          phase: 4,
          audioPath: SAVE_CTX.audioPath,
          analyzeStatus: 'failed',
        }),
      )
    })
  })
})
