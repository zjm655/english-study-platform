import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSpeechEvaluation } from '../useSpeechEvaluation'

// Mock audioToWav
vi.mock('~/utils/audioToWav', () => ({
  toWav16kMono: vi.fn((blob: Blob) => Promise.resolve(blob)),
}))

// Mock window.EngineEvaluat
const mockEngineInstance = {
  wholeFileUpload: vi.fn(),
  startRecord: vi.fn(),
  stopRecord: vi.fn(),
  destroyEngine: vi.fn(),
}

function setupSDK() {
  ;(window as any).EngineEvaluat = vi.fn().mockImplementation(function (opts: any) {
    // 立即触发初始化完成回调
    setTimeout(() => opts.engineFirstInitDone?.(), 0)
    return mockEngineInstance
  })
}

function teardownSDK() {
  delete (window as any).EngineEvaluat
}

describe('useSpeechEvaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupSDK()
  })

  afterEach(() => {
    teardownSDK()
  })

  // ── 初始状态 ──

  it('初始状态：isReady=false, isLoading=false, error=null', () => {
    const { isReady, isLoading, error } = useSpeechEvaluation()
    expect(isReady.value).toBe(false)
    expect(isLoading.value).toBe(false)
    expect(error.value).toBe(null)
  })

  // ── 引擎初始化 ──

  it('initEngine 成功后 isReady=true', async () => {
    const { isReady, initEngine } = useSpeechEvaluation()
    // initEngine 内部调用 ensureSDKLoaded() 然后 new EngineEvaluat(...)
    // engineFirstInitDone 在 next tick 触发
    const promise = initEngine('app1', 'user1', 'warrant1')
    // 等待 microtask 队列清空
    await new Promise((r) => setTimeout(r, 10))
    await promise
    expect(isReady.value).toBe(true)
  })

  it('未初始化时 analyzeRecording 抛错', async () => {
    const { analyzeRecording } = useSpeechEvaluation()
    const blob = new Blob(['test'], { type: 'audio/webm' })
    await expect(analyzeRecording(blob, 'hello')).rejects.toThrow('引擎未初始化')
  })

  it('未初始化时 startRealtime 抛错', async () => {
    const { startRealtime } = useSpeechEvaluation()
    await expect(startRealtime('hello')).rejects.toThrow('引擎未初始化')
  })

  it('已有评测进行中时拒绝重复调用', async () => {
    const { isReady, initEngine, analyzeRecording } = useSpeechEvaluation()
    const promise = initEngine('app1', 'user1', 'warrant1')
    await new Promise((r) => setTimeout(r, 10))
    await promise
    expect(isReady.value).toBe(true)

    // 启动一次评测（不 resolve）
    const blob = new Blob(['test'], { type: 'audio/webm' })
    analyzeRecording(blob, 'hello').catch(() => {})
    // 等待 engine.wholeFileUpload 被调用后 isLoading 设为 true
    await new Promise((r) => setTimeout(r, 10))

    // 第二次调用应抛错
    await expect(analyzeRecording(blob, 'hello')).rejects.toThrow('已有评测请求正在进行中')
  })

  // ── 清理 ──

  it('destroy 重置所有状态', async () => {
    const { isReady, initEngine, destroy } = useSpeechEvaluation()
    const promise = initEngine('app1', 'user1', 'warrant1')
    await new Promise((r) => setTimeout(r, 10))
    await promise
    expect(isReady.value).toBe(true)

    destroy()
    expect(isReady.value).toBe(false)
    expect(mockEngineInstance.destroyEngine).toHaveBeenCalled()
  })

  // ── getRecordedAudio ──

  it('getRecordedAudio 初始返回 null', () => {
    const { getRecordedAudio } = useSpeechEvaluation()
    expect(getRecordedAudio()).toBe(null)
  })
})