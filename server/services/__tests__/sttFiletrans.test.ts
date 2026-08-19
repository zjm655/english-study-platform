import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ===== sttFiletrans 测试 =====
// 覆盖（回退逻辑铁律）：分流 / filetrans 成功与 BizDuration 埋点 / 三错误码 + 41050002 回退 /
// 轮询超时回退 / 21050003 空文本成功 / RUNNING-QUEUEING 继续轮询 / 双后端皆失败 / 配置缺省 flash

// ===== mock logger =====
vi.mock('../../../shared/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}))
;(globalThis as Record<string, unknown>).logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
}

// ===== mock @alicloud/pop-core =====
const mockRequest = vi.fn()
vi.mock('@alicloud/pop-core', () => ({
  default: class RPCClient {
    constructor(public opts: unknown) {}
    request = mockRequest
  },
}))

// ===== mock 依赖模块 =====
const { mockSpeechToText, mockSignUrl, mockLogCloudServiceCall, mockQuery, mockGetSysConfigKeys } =
  vi.hoisted(() => ({
    mockSpeechToText: vi.fn(),
    mockSignUrl: vi.fn(),
    mockLogCloudServiceCall: vi.fn(),
    mockQuery: vi.fn(),
    mockGetSysConfigKeys: vi.fn(),
  }))

vi.mock('../speechToText', () => ({ speechToText: mockSpeechToText }))
vi.mock('#server/utils/oss', () => ({ signUrl: mockSignUrl }))
vi.mock('#server/utils/cloudServiceLog', () => ({ logCloudServiceCall: mockLogCloudServiceCall }))
vi.mock('#server/utils/fileLogger', () => ({ fileLog: vi.fn(), fileLogError: vi.fn() }))
vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

// ===== mock useRuntimeConfig =====
const defaultConfig = {
  nls: {
    accessKeyId: 'test-ak',
    accessKeySecret: 'test-sk',
    gateway: 'nls-gateway.aliyuncs.com',
    appKey: 'test-appkey',
  },
}
const mockRuntimeConfig = vi.fn(() => defaultConfig)
;(globalThis as Record<string, unknown>).useRuntimeConfig = mockRuntimeConfig

// 动态 import：破除模块级 client 单例 / lastUsedBackend 状态
async function loadModule() {
  vi.resetModules()
  return import('../sttFiletrans')
}

/** 配置 stt_backend 的 configStore 桩（任务路径 getSttBackend 经 configStore 读取） */
function setBackend(backend: string) {
  mockGetSysConfigKeys.mockResolvedValue(new Map([['stt_backend', backend]]))
}

const SUBMIT_OK = { TaskId: 'task-1', StatusCode: 21050000, StatusText: 'SUCCESS' }
const RESULT_OK = {
  TaskId: 'task-1',
  StatusCode: 21050000,
  StatusText: 'SUCCESS',
  BizDuration: 12345,
  Result: { Sentences: [{ Text: 'Hello ' }, { Text: 'world.' }] },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockRuntimeConfig.mockImplementation(() => defaultConfig)
  mockSignUrl.mockResolvedValue('https://signed-url.example.com/a.mp3')
  mockSpeechToText.mockResolvedValue({ success: true, text: 'flash-text' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('recognizeSpeech 分流', () => {
  it("stt_backend='flash' 时直走 flash，不触 filetrans/signUrl", async () => {
    setBackend('flash')
    const { recognizeSpeech } = await loadModule()
    const res = await recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    expect(res).toEqual({ success: true, text: 'flash-text' })
    expect(mockSpeechToText).toHaveBeenCalledTimes(1)
    expect(mockSignUrl).not.toHaveBeenCalled()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('缺 ossKey 时即使配置 filetrans 也走 flash', async () => {
    setBackend('filetrans')
    const { recognizeSpeech } = await loadModule()
    const res = await recognizeSpeech({ audioBuffer: Buffer.from('a') })
    expect(res.success).toBe(true)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('配置读取失败（configStore 抛错）时保守默认 flash', async () => {
    mockGetSysConfigKeys.mockRejectedValue(new Error('configStore down'))
    const { recognizeSpeech } = await loadModule()
    const res = await recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    expect(res.success).toBe(true)
    expect(mockSpeechToText).toHaveBeenCalledTimes(1)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('缺键（空 Map）时保守默认 flash', async () => {
    mockGetSysConfigKeys.mockResolvedValue(new Map())
    const { recognizeSpeech } = await loadModule()
    const res = await recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    expect(res.success).toBe(true)
    expect(mockSpeechToText).toHaveBeenCalledTimes(1)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('filetrans 成功：文本拼接 + 埋点带 bizDurationMs，不调 flash', async () => {
    setBackend('filetrans')
    mockRequest.mockResolvedValueOnce(SUBMIT_OK).mockResolvedValueOnce(RESULT_OK)
    const { recognizeSpeech } = await loadModule()

    const promise = recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    await vi.advanceTimersByTimeAsync(5000) // 首轮轮询间隔
    const res = await promise

    expect(res.success).toBe(true)
    expect(res.text).toBe('Hello world.')
    expect(mockSpeechToText).not.toHaveBeenCalled()
    const entry = mockLogCloudServiceCall.mock.calls.find(
      ([e]) => e.operation === 'filetrans' && e.success,
    )?.[0]
    expect(entry?.bizDurationMs).toBe(12345)
  })
})

describe('回退集', () => {
  it.each([[41050001], [40000005], [41050002]])(
    'GetTaskResult 终态错误码 %d → 回退 flash 并埋 sttFallback，不写配置',
    async (code) => {
      setBackend('filetrans')
      mockRequest
        .mockResolvedValueOnce(SUBMIT_OK)
        .mockResolvedValueOnce({ TaskId: 'task-1', StatusCode: code, StatusText: 'ERR' })
      const { recognizeSpeech } = await loadModule()

      const promise = recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
      await vi.advanceTimersByTimeAsync(5000)
      const res = await promise

      expect(res).toEqual({ success: true, text: 'flash-text' }) // 回退 flash 成功
      expect(mockLogCloudServiceCall.mock.calls.some(([e]) => e.operation === 'sttFallback')).toBe(
        true,
      )
      // 不写回配置：任务路径配置走 configStore 只读，db 无任何 UPDATE
      expect(
        mockQuery.mock.calls.every(([sql]) => !String(sql).toUpperCase().includes('UPDATE')),
      ).toBe(true)
    },
  )

  it('SubmitTask 抛错携带 40000010 → 回退 flash', async () => {
    setBackend('filetrans')
    mockRequest.mockRejectedValueOnce({ code: '40000010', message: 'FREE_TRIAL_EXPIRED' })
    const { recognizeSpeech } = await loadModule()
    const res = await recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    expect(res).toEqual({ success: true, text: 'flash-text' })
    expect(mockLogCloudServiceCall.mock.calls.some(([e]) => e.operation === 'sttFallback')).toBe(
      true,
    )
  })

  it('轮询超时（10 分钟恒 RUNNING）→ 回退 flash', async () => {
    setBackend('filetrans')
    mockRequest
      .mockResolvedValueOnce(SUBMIT_OK)
      .mockResolvedValue({ TaskId: 'task-1', StatusCode: 21050001, StatusText: 'RUNNING' })
    const { recognizeSpeech } = await loadModule()

    const promise = recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    const res = await promise

    expect(res).toEqual({ success: true, text: 'flash-text' })
    expect(mockLogCloudServiceCall.mock.calls.some(([e]) => e.operation === 'sttFallback')).toBe(
      true,
    )
  })

  it('非回退错误（41050003 之外的格式类错误）不回退，直接失败', async () => {
    setBackend('filetrans')
    mockRequest.mockResolvedValueOnce(SUBMIT_OK).mockResolvedValueOnce({
      TaskId: 'task-1',
      StatusCode: 41050006,
      StatusText: 'FILE_PARSE_FAILED',
    })
    const { recognizeSpeech } = await loadModule()

    const promise = recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    await vi.advanceTimersByTimeAsync(5000)
    const res = await promise

    expect(res.success).toBe(false)
    expect(res.error).toContain('41050006')
    expect(mockSpeechToText).not.toHaveBeenCalled()
  })

  it('回退后 flash 也失败 → success:false 且 error 非空', async () => {
    setBackend('filetrans')
    mockRequest.mockRejectedValueOnce({ code: '40000005', message: 'TOO_MANY_REQUESTS' })
    mockSpeechToText.mockResolvedValue({ success: false, error: '语音识别请求失败' })
    const { recognizeSpeech } = await loadModule()
    const res = await recognizeSpeech({ audioBuffer: Buffer.from('a'), ossKey: 'k.mp3' })
    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
  })
})

describe('fileTransRecognize 状态机', () => {
  it('21050003（无有效语音）视为成功空文本，不可回退', async () => {
    setBackend('filetrans')
    mockRequest
      .mockResolvedValueOnce(SUBMIT_OK)
      .mockResolvedValueOnce({ TaskId: 'task-1', StatusCode: 21050003, StatusText: 'NO_VALID' })
    const { fileTransRecognize } = await loadModule()

    const promise = fileTransRecognize('https://x/a.mp3')
    await vi.advanceTimersByTimeAsync(5000)
    const res = await promise

    expect(res.success).toBe(true)
    expect(res.text).toBe('')
    expect(res.fallbackEligible).toBeUndefined()
  })

  it('QUEUEING → RUNNING → SUCCESS 多轮轮询', async () => {
    setBackend('filetrans')
    mockRequest
      .mockResolvedValueOnce(SUBMIT_OK)
      .mockResolvedValueOnce({ TaskId: 'task-1', StatusCode: 21050002, StatusText: 'QUEUEING' })
      .mockResolvedValueOnce({ TaskId: 'task-1', StatusCode: 21050001, StatusText: 'RUNNING' })
      .mockResolvedValueOnce(RESULT_OK)
    const { fileTransRecognize } = await loadModule()

    const promise = fileTransRecognize('https://x/a.mp3')
    // 三轮：5s + 7.5s + 11.25s（×1.5 衰减）
    await vi.advanceTimersByTimeAsync(30_000)
    const res = await promise

    expect(res.success).toBe(true)
    expect(res.text).toBe('Hello world.')
    // SubmitTask + 3 次 GetTaskResult
    expect(mockRequest).toHaveBeenCalledTimes(4)
  })
})

describe('getSttMonitorSnapshot', () => {
  it('聚合今日用量/回退数/配置与试用倒计时', async () => {
    vi.setSystemTime(new Date('2026-07-27T12:00:00'))
    mockQuery
      .mockResolvedValueOnce([{ total: '120000' }]) // SUM 返回字符串也归一
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([
        { config_key: 'stt_backend', config_value: 'filetrans' },
        { config_key: 'stt_trial_start_date', config_value: '2026-07-01' },
      ])
    const { getSttMonitorSnapshot } = await loadModule()
    const snap = await getSttMonitorSnapshot()
    expect(snap.todayBizMs).toBe(120000)
    expect(snap.todayFallbacks).toBe(2)
    expect(snap.backend).toBe('filetrans')
    expect(snap.trialStartDate).toBe('2026-07-01')
    // 2026-07-01 + 90 天 = 2026-09-29 00:00，距 2026-07-27 12:00 为 63.5 天，向下取整 63（不足一天不计）
    expect(snap.trialDaysLeft).toBe(63)
  })

  it("试用日期为 '-' 占位时倒计时为 null", async () => {
    mockQuery
      .mockResolvedValueOnce([{ total: null }])
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([
        { config_key: 'stt_backend', config_value: 'flash' },
        { config_key: 'stt_trial_start_date', config_value: '-' },
      ])
    const { getSttMonitorSnapshot } = await loadModule()
    const snap = await getSttMonitorSnapshot()
    expect(snap.todayBizMs).toBe(0)
    expect(snap.backend).toBe('flash')
    expect(snap.trialStartDate).toBeNull()
    expect(snap.trialDaysLeft).toBeNull()
  })
})
