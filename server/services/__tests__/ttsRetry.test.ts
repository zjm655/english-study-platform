/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ttsWithRetry } from '../ttsRetry'

// ===== ttsRetry 测试 =====
// 重试策略：network/closed 最多 2 次、timeout 仅 1 次、auth 与 kind 缺失不重试

const { mockTextToSpeech, mockFileLog } = vi.hoisted(() => ({
  mockTextToSpeech: vi.fn(),
  mockFileLog: vi.fn(),
}))

vi.mock('../tts', () => ({ textToSpeech: mockTextToSpeech }))
vi.mock('#server/utils/fileLogger', () => ({ fileLog: mockFileLog, fileLogError: vi.fn() }))

const OK = { success: true, audio: Buffer.from('mp3') }
const fail = (errorKind?: string) => ({ success: false, error: '模拟失败', errorKind })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 配合 fake timers 执行：推进所有退避定时器直至 Promise 完成 */
async function run(p: Promise<unknown>) {
  await vi.runAllTimersAsync()
  return p
}

describe('ttsWithRetry', () => {
  it('首次成功不重试', async () => {
    mockTextToSpeech.mockResolvedValue(OK)
    const res: any = await run(ttsWithRetry('hello'))
    expect(res.success).toBe(true)
    expect(mockTextToSpeech).toHaveBeenCalledTimes(1)
    expect(mockFileLog).not.toHaveBeenCalled()
  })

  it('network 失败重试后成功', async () => {
    mockTextToSpeech.mockResolvedValueOnce(fail('network')).mockResolvedValueOnce(OK)
    const res: any = await run(ttsWithRetry('hello'))
    expect(res.success).toBe(true)
    expect(mockTextToSpeech).toHaveBeenCalledTimes(2)
    expect(mockFileLog).toHaveBeenCalledTimes(1)
  })

  it('network 连续失败最多重试 2 次（共 3 次调用）后返回失败', async () => {
    mockTextToSpeech.mockResolvedValue(fail('network'))
    const res: any = await run(ttsWithRetry('hello'))
    expect(res.success).toBe(false)
    expect(mockTextToSpeech).toHaveBeenCalledTimes(3)
  })

  it('closed 类失败同样最多重试 2 次', async () => {
    mockTextToSpeech.mockResolvedValue(fail('closed'))
    await run(ttsWithRetry('hello'))
    expect(mockTextToSpeech).toHaveBeenCalledTimes(3)
  })

  it('timeout 仅重试 1 次（共 2 次调用）', async () => {
    mockTextToSpeech.mockResolvedValue(fail('timeout'))
    const res: any = await run(ttsWithRetry('hello'))
    expect(res.success).toBe(false)
    expect(mockTextToSpeech).toHaveBeenCalledTimes(2)
  })

  it('auth 类失败不重试', async () => {
    mockTextToSpeech.mockResolvedValue(fail('auth'))
    const res: any = await run(ttsWithRetry('hello'))
    expect(res.success).toBe(false)
    expect(mockTextToSpeech).toHaveBeenCalledTimes(1)
  })

  it('errorKind 缺失不重试（测试 mock / 旧调用方兼容）', async () => {
    mockTextToSpeech.mockResolvedValue(fail(undefined))
    const res: any = await run(ttsWithRetry('hello'))
    expect(res.success).toBe(false)
    expect(mockTextToSpeech).toHaveBeenCalledTimes(1)
  })

  it('unknown 类失败不重试', async () => {
    mockTextToSpeech.mockResolvedValue(fail('unknown'))
    await run(ttsWithRetry('hello'))
    expect(mockTextToSpeech).toHaveBeenCalledTimes(1)
  })

  it('透传 voice 参数', async () => {
    mockTextToSpeech.mockResolvedValue(OK)
    await run(ttsWithRetry('hello', 'en-GB-SoniaNeural'))
    expect(mockTextToSpeech).toHaveBeenCalledWith('hello', 'en-GB-SoniaNeural')
  })
})
