
·/**
 * 阿里云智能科教生成平台 EngineEvaluat 类型声明
 * window.EngineEvaluat 由 engine.js 挂载
 */

interface EngineEvaluatConstructorParams {
  applicationId: string
  userId: string
  warrantId: string
  customRecord?: boolean
  coreType?: string
  logIsOpen?: boolean
  coreTimeout?: number
  serverTimeout?: number
  intermission?: number
  engineLinksAddress?: string[]
  engineFirstInitDone?: () => void
  engineBackResultDone?: (msg: string) => void
  engineBackResultFail?: (msg: string) => void
  engineRequestIdCallback?: (requestId: string) => void
  micAllowCallback?: () => void
  micForbidCallback?: () => void
  micVolumeCallback?: (data: number) => void
  JSSDKNotSupport?: () => void
  noNetwork?: () => void
  playAudioComplete?: (data: unknown) => void
  playAudioError?: (data: unknown) => void
  logAccept?: (data: unknown) => void
  audioDataCallback?: (data: unknown, isLast: boolean) => void
}

interface EngineEvaluatInstance {
  startRecord(
    params: {
      coreType: string
      refText: string
      precision?: number
      evalTime?: number
      warrantId?: string
      saveAudio?: number
      compress?: string
    },
    done?: () => void,
    fail?: () => void,
  ): void
  stopRecord(): void
  cancelRecord(): void
  start(params: Record<string, unknown>): void
  feed(base64String: string): void
  stop(): void
  wholeFileUpload(event: Event, params: { coreType: string; refText: string; warrantId?: string }): void
  destroyEngine(): void
  setMicVolume(num: number): void
  loadAudio(url: string): void
  playAudio(): void
  pauseAudio(): void
  stopAudio(): void
  getDuration(): number
  getCurrentTime(): number
  setAudioVolume(num: number): void
}

interface EngineEvaluatClass {
  new (params: EngineEvaluatConstructorParams): EngineEvaluatInstance
}

interface Window {
  EngineEvaluat: EngineEvaluatClass
}
