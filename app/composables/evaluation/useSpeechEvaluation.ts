/**
 * 阿里云智能科教生成平台评测 SDK 封装
 *
 * 职责:
 * - 加载并等待 window.EngineEvaluat SDK 就绪
 * - 初始化引擎（warrantId 由后端鉴权接口提供）
 * - Phase 3: analyzeRecording() — wholeFileUpload 方式
 * - Phase 4: startRealtime() / stopRealtime() — 实时 WebSocket 评测，已完整实现
 *
 * 使用示例 (Phase 3):
 *   const { isReady, isLoading, error, initEngine, analyzeRecording, destroy } = useSpeechEvaluation()
 *   await initEngine(appId, userId, warrantId)
 *   const result = await analyzeRecording(blob, refText)
 *   console.log(result.score, result.wordScores)
 */

import type { WordScore } from '#shared/types/recording'
import { toWav16kMono } from '~/utils/audioToWav'

// ─── SDK 原生结果类型 ────────────────────────────────────────

// ─── composable 导出类型 ────────────────────────────────────

export interface EvaluationResult {
  score: number
  wordScores: WordScore[]
  /** SDK 原始响应 JSON 字符串 */
  rawResult: string
}

// ─── 辅助函数 ───────────────────────────────────────────────

const ENGINE_SDK_SRC = '/sdk/engine.js'

/**
 * 按需注入评测 SDK（幂等，client-only）
 *
 * SDK 体积约 368KB 且仅片段学习页使用，已从 nuxt.config.ts 全局 head 移除。
 * 进入片段学习页时调用本函数预下载；就绪判定仍由 ensureSDKLoaded 的轮询完成。
 */
export function preloadEngineScript(): void {
  if (import.meta.server) return
  // 已挂载或同 src 脚本已在 DOM 中则跳过
  if (window.EngineEvaluat) return
  if (document.querySelector(`script[src="${ENGINE_SDK_SRC}"]`)) return
  const script = document.createElement('script')
  script.src = ENGINE_SDK_SRC
  script.defer = true
  document.head.appendChild(script)
}

function scoreToStatus(score: number): WordScore['status'] {
  if (score >= 80) return 'correct'
  if (score >= 60) return 'minor'
  if (score >= 40) return 'wrong'
  return 'missing'
}

function parseResult(msg: string): EvaluationResult {
  const data = JSON.parse(msg) as {
    result?: {
      overall?: number
      details?: {
        text: string
        score: number
        snt_details: { char: string; score: number }[]
      }[]
    }
  }
  const result = data.result
  const allWords: { char: string; score: number }[] = []

  if (result?.details) {
    for (const sentence of result.details) {
      if (sentence.snt_details) {
        for (const word of sentence.snt_details) {
          if (word.char?.trim()) {
            allWords.push(word)
          }
        }
      }
    }
  }

  const wordScores: WordScore[] = allWords.map((w) => ({
    word: w.char,
    score: w.score,
    status: scoreToStatus(w.score),
  }))

  return {
    score: result?.overall ?? 0,
    wordScores,
    rawResult: msg,
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

  // Phase 4 实时录音音频收集（saveAudio:1 时经 audioDataCallback 分片回流）
  let audioParts: BlobPart[] = []
  let recordedAudioBlob: Blob | null = null

  /** 把 audioDataCallback 的分片（类型运行时不确定）归一化为 BlobPart */
  function normalizeAudioChunk(data: unknown): BlobPart | null {
    if (!data) return null
    if (data instanceof Blob) return data
    if (data instanceof ArrayBuffer) return data
    if (ArrayBuffer.isView(data)) return data as ArrayBufferView
    if (typeof data === 'string') {
      // 可能是 base64 字符串
      try {
        const bin = atob(data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
      } catch {
        return null
      }
    }
    if (import.meta.dev) logger.warn('[SpeechEval] 未知的 audioDataCallback 分片类型:', typeof data)
    return null
  }

  // ── SDK 加载等待 ──

  function ensureSDKLoaded(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window !== 'undefined' && window.EngineEvaluat) {
        resolve()
        return
      }
      // 兜底：若页面未预注入（或直达评测入口），此处幂等补注入后再轮询
      preloadEngineScript()
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
              if (import.meta.dev) logger.log('[SpeechEval] 引擎初始化成功')
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

            // Phase 4：saveAudio:1 时实时回流录音分片（ogg），累积后组装
            audioDataCallback: (data: unknown, isLast: boolean) => {
              const chunk = normalizeAudioChunk(data)
              if (chunk) audioParts.push(chunk)
              if (isLast) {
                recordedAudioBlob = new Blob(audioParts, { type: 'audio/ogg' })
              }
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

    // 关键：MediaRecorder 产出的 WebM/Opus@48kHz 无法被 SDK 客户端解码链完整解析，
    // 先转码为评测引擎推荐的 16kHz 单声道 WAV，文件名/魔数须与内容一致。
    let wavBlob: Blob
    try {
      wavBlob = await toWav16kMono(blob)
    } catch (e) {
      isLoading.value = false
      throw new Error(`音频转码失败: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }

    const file = new File([wavBlob], 'recording.wav', { type: 'audio/wav' })
    const mockEvent = { target: { files: [file] } } as unknown as Event
    const eng = engine

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

  // ── Phase 4：实时录音评测（影子跟读）──

  /**
   * 开始实时录音评测。不设 evalTime，改由 stopRealtime() 手动停止。
   * saveAudio:1 以便经 audioDataCallback 收集录音（ogg）。
   * @returns 评测结果 Promise（由 engineBackResultDone 回流 resolve）
   */
  function startRealtime(
    refText: string,
    coreType: string = 'en.pred.score',
    warrantId?: string,
  ): Promise<EvaluationResult> {
    if (!engine || !isReady.value) {
      return Promise.reject(new Error('引擎未初始化或未就绪，请先调用 initEngine'))
    }
    if (isLoading.value) {
      return Promise.reject(new Error('已有评测请求正在进行中'))
    }

    isLoading.value = true
    error.value = null
    audioParts = []
    recordedAudioBlob = null
    const eng = engine

    return new Promise<EvaluationResult>((resolve, reject) => {
      pendingResolve = resolve
      pendingReject = reject
      try {
        eng.startRecord({ coreType, refText, warrantId, saveAudio: 1 })
      } catch (e) {
        pendingResolve = null
        pendingReject = null
        isLoading.value = false
        reject(e)
      }
    })
  }

  /** 停止实时录音，结果经 engineBackResultDone 回流 startRealtime 的 Promise。 */
  function stopRealtime(): void {
    if (engine) {
      try {
        engine.stopRecord()
      } catch (e) {
        if (import.meta.dev) logger.warn('[SpeechEval] stopRecord 异常:', e)
      }
    }
  }

  /** 获取实时录音收集到的音频 Blob（ogg）。需在评测完成后调用。 */
  function getRecordedAudio(): Blob | null {
    return recordedAudioBlob
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
    audioParts = []
    recordedAudioBlob = null
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
    /** Phase 4：开始实时录音评测（影子跟读） */
    startRealtime,
    /** Phase 4：停止实时评测 */
    stopRealtime,
    /** Phase 4：获取实时录音收集到的 ogg 音频 Blob */
    getRecordedAudio,
    /** 销毁引擎，释放 WebSocket 连接 */
    destroy,
  }
}
