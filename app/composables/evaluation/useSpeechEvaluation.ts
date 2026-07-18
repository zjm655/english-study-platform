/**
 * 阿里云智能科教生成平台评测 SDK 封装
 *
 * 职责:
 * - 加载并等待 window.EngineEvaluat SDK 就绪
 * - 初始化引擎（warrantId 由后端鉴权接口提供）
 * - Phase 3: analyzeRecording() — wholeFileUpload 方式
 * - Phase 4: startRealtime() / stopRealtime() — 占位，后续实现
 *
 * 使用示例 (Phase 3):
 *   const { isReady, isLoading, error, initEngine, analyzeRecording, destroy } = useSpeechEvaluation()
 *   await initEngine(appId, userId, warrantId)
 *   const result = await analyzeRecording(blob, refText)
 *   console.log(result.score, result.wordScores)
 */

import type { WordScore } from '#shared/types/recording'

// ─── SDK 原生结果类型 ────────────────────────────────────────

interface SdkWordDetail {
  char: string
  score: number
}

interface SdkEngineResult {
  result: {
    overall: number
    rank: string
    details: SdkWordDetail[]
  }
  applicationId: string
  recordId: string
}

// ─── composable 导出类型 ────────────────────────────────────

export interface EvaluationResult {
  score: number
  wordScores: WordScore[]
  /** SDK 逐词 char 拼接出的识别文本 */
  recognizedText: string
}

// ─── 辅助函数 ───────────────────────────────────────────────

function scoreToStatus(score: number): WordScore['status'] {
  if (score >= 80) return 'correct'
  if (score >= 60) return 'minor'
  if (score >= 40) return 'wrong'
  return 'missing'
}

function parseResult(msg: string): EvaluationResult {
  const data: SdkEngineResult = JSON.parse(msg)
  const details = data.result?.details ?? []
  const wordScores: WordScore[] = details.map((d) => ({
    word: d.char,
    score: d.score,
    status: scoreToStatus(d.score),
  }))
  const recognizedText = details.map((d) => d.char).join(' ')

  return {
    score: data.result?.overall ?? 0,
    wordScores,
    recognizedText,
  }
}

// ─── composable ─────────────────────────────────────────────

export function useSpeechEvaluation() {
  // ── 响应式状态 ──

  const isReady = ref(false)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // ── 内部状态 ──

  let engine: EngineEvaluatInstance | null = null
  let initPromise: Promise<void> | null = null
  let pendingResolve: ((r: EvaluationResult) => void) | null = null
  let pendingReject: ((e: Error) => void) | null = null

  // ── SDK 加载等待 ──

  function ensureSDKLoaded(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && window.EngineEvaluat) {
        resolve()
        return
      }
      const timer = setInterval(() => {
        if (window.EngineEvaluat) {
          clearInterval(timer)
          resolve()
        }
      }, 120)
      setTimeout(() => {
        clearInterval(timer)
        reject(new Error('评测 SDK（engine.js）加载超时，请刷新页面'))
      }, 20_000)
    })
  }

  // ── 引擎初始化 ──

  async function initEngine(
    applicationId: string,
    userId: string,
    warrantId: string,
  ): Promise<void> {
    if (initPromise) return initPromise

    initPromise = (async () => {
      await ensureSDKLoaded()

      return new Promise<void>((resolve, reject) => {
        try {
          engine = new window.EngineEvaluat({
            applicationId,
            userId,
            warrantId,
            logIsOpen: true,
            coreTimeout: 15_000,
            serverTimeout: 30_000,

            engineFirstInitDone: () => {
              if (process.dev) console.log('[SpeechEval] 引擎初始化成功')
              isReady.value = true
              resolve()
            },

            engineBackResultDone: (msg: string) => {
              pendingResolve?.(parseResult(msg))
              pendingResolve = null
              pendingReject = null
              isLoading.value = false
            },

            engineBackResultFail: (msg: string) => {
              pendingReject?.(new Error(msg ?? '评测服务返回失败'))
              pendingResolve = null
              pendingReject = null
              isLoading.value = false
            },

            noNetwork: () => {
              error.value = '网络连接异常，无法进行评测'
              pendingReject?.(new Error('网络连接异常'))
              pendingResolve = null
              pendingReject = null
              isLoading.value = false
            },

            JSSDKNotSupport: () => {
              error.value = '当前浏览器不支持评测 SDK'
              reject(new Error('浏览器不兼容'))
              initPromise = null
            },
          })
        } catch (e) {
          initPromise = null
          reject(e)
        }
      })
    })()

    return initPromise
  }

  // ── Phase 3：分析已有录音文件 ──

  async function analyzeRecording(
    blob: Blob,
    refText: string,
    coreType: string = 'en.pred.score',
  ): Promise<EvaluationResult> {
    if (!engine || !isReady.value) {
      throw new Error('引擎未初始化或未就绪，请先调用 initEngine')
    }
    if (isLoading.value) {
      throw new Error('已有评测请求正在进行中')
    }

    isLoading.value = true
    error.value = null

    const file = new File([blob], 'recording.webm', { type: blob.type })
    const mockEvent = { target: { files: [file] } } as unknown as Event
    const eng = engine // eslint-disable-line prefer-const -- 回调内类型收窄

    return new Promise<EvaluationResult>((resolve, reject) => {
      pendingResolve = resolve
      pendingReject = reject

      try {
        eng!.wholeFileUpload(mockEvent, { coreType, refText })
      } catch (e) {
        pendingResolve = null
        pendingReject = null
        isLoading.value = false
        reject(e)
      }
    })
  }

  // ── Phase 4 占位 ──

  async function startRealtime(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _refText: string,
  ): Promise<EvaluationResult> {
    throw new Error('Phase 4 影子跟读评测尚未实现')
  }

  function stopRealtime(): void {
    // Phase 4 占位
  }

  // ── 清理 ──

  function destroy(): void {
    if (engine) {
      try {
        engine.destroyEngine()
      } catch {
        // 忽略销毁时的错误
      }
      engine = null
    }
    isReady.value = false
    isLoading.value = false
    error.value = null
    pendingResolve = null
    pendingReject = null
    initPromise = null
  }

  onBeforeUnmount(destroy)

  return {
    /** SDK 是否加载并初始化完成 */
    isReady: readonly(isReady),
    /** 是否正在评测 */
    isLoading: readonly(isLoading),
    /** 错误信息 */
    error: readonly(error),
    /** 初始化引擎（需先通过后端获取 warrantId） */
    initEngine,
    /** Phase 3：分析已有录音文件 */
    analyzeRecording,
    /** Phase 4：开始实时录音评测（未实现） */
    startRealtime,
    /** Phase 4：停止实时评测（未实现） */
    stopRealtime,
    /** 销毁引擎，释放 WebSocket 连接 */
    destroy,
  }
}
