import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== mock @alicloud/pop-core =====
const mockRequest = vi.fn()
vi.mock('@alicloud/pop-core', () => ({
  default: class RPCClient {
    constructor(public opts: unknown) {}
    request = mockRequest
  },
}))

// ===== mock global fetch =====
const mockFetch = vi.fn()
globalThis.fetch = mockFetch as unknown as typeof fetch

// ===== mock useRuntimeConfig =====
const mockRuntimeConfig = vi.fn((): { nls: Record<string, string> } => ({
  nls: {
    accessKeyId: 'test-ak',
    accessKeySecret: 'test-sk',
    gateway: 'nls-gateway.aliyuncs.com',
    appKey: 'test-appkey',
  },
}))
;(globalThis as Record<string, unknown>).useRuntimeConfig = mockRuntimeConfig

// 动态 import 避免 mock 提升问题
async function loadModule() {
  vi.resetModules()
  return import('../speechToText')
}

describe('speechToText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockReset()
    mockFetch.mockReset()
  })

  it('当 audioBuffer 为空时返回错误', async () => {
    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.alloc(0))
    expect(result.success).toBe(false)
    expect(result.error).toBe('音频数据不能为空')
  })

  it('当 NLS 配置缺失时返回错误', async () => {
    mockRuntimeConfig.mockReturnValueOnce({ nls: {} })
    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))
    expect(result.success).toBe(false)
    expect(result.error).toBe('NLS 配置缺失')
  })

  it('Token 获取失败时返回错误', async () => {
    mockRequest.mockRejectedValueOnce(new Error('RPC 错误'))
    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))
    expect(result.success).toBe(false)
    expect(result.error).toBe('Token 获取失败')
  })

  it('成功获取 Token 后发起识别请求', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'token-123', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: {
          duration: 1234,
          sentences: [{ text: 'Hello world' }],
        },
      }),
    } as Response)

    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))

    expect(mockRequest).toHaveBeenCalledWith('CreateToken', {})
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const fetchUrl = mockFetch.mock.calls[0]![0] as string
    expect(fetchUrl).toContain('appkey=test-appkey')
    expect(fetchUrl).toContain('token=token-123')
    expect(result.success).toBe(true)
    expect(result.text).toBe('Hello world')
    expect(result.duration).toBe(1234)
  })

  it('复用缓存的 Token，不重复请求 CreateToken', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'cached-token', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: { duration: 100, sentences: [{ text: 'First' }] },
      }),
    } as Response)

    const { speechToText } = await loadModule()
    await speechToText(Buffer.from('audio1'))

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: { duration: 200, sentences: [{ text: 'Second' }] },
      }),
    } as Response)

    const result2 = await speechToText(Buffer.from('audio2'))
    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(result2.success).toBe(true)
    expect(result2.text).toBe('Second')
  })

  it('Token 过期后自动重新获取', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'expired-token', ExpireTime: Math.floor(Date.now() / 1000) - 10 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: { duration: 100, sentences: [{ text: 'Old' }] },
      }),
    } as Response)

    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'new-token', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: { duration: 200, sentences: [{ text: 'New' }] },
      }),
    } as Response)

    const { speechToText } = await loadModule()
    await speechToText(Buffer.from('audio1'))
    const result2 = await speechToText(Buffer.from('audio2'))

    expect(mockRequest).toHaveBeenCalledTimes(2)
    expect(result2.text).toBe('New')
  })

  it('FlashRecognizer 返回非 20000000 时返回错误', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'token-456', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 40000001,
        message: '参数错误',
      }),
    } as Response)

    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))
    expect(result.success).toBe(false)
    expect(result.error).toContain('参数错误')
  })

  it('FlashRecognizer 返回 sentences 为空数组时返回空文本', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'token-789', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: { duration: 0, sentences: [] },
      }),
    } as Response)

    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))
    expect(result.success).toBe(true)
    expect(result.text).toBe('')
  })

  it('FlashRecognizer 网络超时返回友好错误', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'token-abc', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'))

    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))
    expect(result.success).toBe(false)
    expect(result.error).toBe('语音识别请求失败')
  })

  it('多句结果按顺序拼接文本', async () => {
    mockRequest.mockResolvedValueOnce({
      Token: { Id: 'token-def', ExpireTime: Math.floor(Date.now() / 1000) + 3600 },
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 20000000,
        flash_result: {
          duration: 3000,
          sentences: [
            { text: 'First sentence.' },
            { text: ' Second sentence.' },
          ],
        },
      }),
    } as Response)

    const { speechToText } = await loadModule()
    const result = await speechToText(Buffer.from('fake-audio'))
    expect(result.success).toBe(true)
    expect(result.text).toBe('First sentence. Second sentence.')
  })
})
