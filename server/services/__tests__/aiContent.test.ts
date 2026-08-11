/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { generateLearningContent, generateTitle } from '../aiContent'

// ===== aiContent 测试 =====
// 覆盖：失败埋点补记（success=false 与业务结果一致）/ 失败重试（最多 2 次尝试）/ max_tokens 运行时配置
// serverFetch / logger / useRuntimeConfig 在源码中是 Nitro auto-import 的裸全局，测试用 vi.stubGlobal 提供

const mocks = vi.hoisted(() => ({
  mockServerFetch: vi.fn(),
  mockLog: vi.fn(),
  mockGetParams: vi.fn(),
  mockFileLog: vi.fn(),
  mockWithQueue: vi.fn(),
}))

vi.mock('#server/utils/cloudServiceLog', () => ({ logCloudServiceCall: mocks.mockLog }))
vi.mock('#server/utils/deepseekConfig', () => ({ getDeepseekParams: mocks.mockGetParams }))
vi.mock('#server/utils/fileLogger', () => ({ fileLog: mocks.mockFileLog, fileLogError: vi.fn() }))
vi.mock('./serviceQueue', () => ({
  withQueue: mocks.mockWithQueue ?? ((_k: string, fn: () => Promise<unknown>) => fn()),
}))

/** 合法教学内容 JSON（DeepSeek 应返回的格式） */
const VALID_CONTENT = JSON.stringify({
  translation: '中文翻译',
  vocabulary: [
    {
      word: 'hello',
      forms: '',
      phonetic: '/həˈloʊ/',
      meaning: 'n. 你好',
      exampleSentence: 'Hello world.',
      exampleTranslation: '你好世界。',
    },
  ],
  questions: [{ question: 'Q?', options: ['A. x', 'B. y', 'C. z', 'D. w'], answer: 'A. x' }],
})

/** 构造 DeepSeek HTTP 200 响应（content 由调用方指定） */
function okJsonResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    text: async () => '',
  }
}

/** 提取 mockLog 收到的全部失败埋点条目 */
function failureLogs(): Array<{ operation: string; errorMessage?: string }> {
  return mocks.mockLog.mock.calls.map(([entry]) => entry).filter((e: any) => e.success === false)
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks 不清理 mockResolvedValueOnce 队列，显式 reset 防用例间串扰
  mocks.mockServerFetch.mockReset()
  mocks.mockWithQueue.mockReset()
  mocks.mockGetParams.mockReset()

  vi.stubGlobal('serverFetch', mocks.mockServerFetch)
  vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  vi.stubGlobal('useRuntimeConfig', () => ({
    deepseek: { apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  }))

  mocks.mockWithQueue.mockImplementation((_k: string, fn: () => Promise<unknown>) => fn())
  mocks.mockGetParams.mockResolvedValue({
    contentTimeoutMs: 120000,
    titleTimeoutMs: 60000,
    contentMaxTokens: 4000,
    titleMaxTokens: 200,
  })
  mocks.mockServerFetch.mockResolvedValue(okJsonResponse(VALID_CONTENT))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateLearningContent', () => {
  it('content 为空：返回 success=false，且补记 success=false（errorMessage 含「未返回有效内容」）', async () => {
    mocks.mockServerFetch.mockResolvedValue(okJsonResponse(''))

    const res = await generateLearningContent('Hello world.')

    expect(res.success).toBe(false)
    expect(res.error).toBe('AI 未返回有效内容')
    const failed = failureLogs().find((e) => e.operation === 'generateContent')
    expect(failed).toBeTruthy()
    expect(failed!.errorMessage).toContain('未返回有效内容')
  })

  it('content 是残缺 JSON：返回 success=false，且补记失败（errorMessage 含「解析失败」）', async () => {
    mocks.mockServerFetch.mockResolvedValue(
      okJsonResponse('{"translation": "haha", "vocabulary": ['),
    )

    const res = await generateLearningContent('Hello world.')

    expect(res.success).toBe(false)
    expect(res.error).toContain('AI 生成内容解析失败')
    const failed = failureLogs().find((e) => e.operation === 'generateContent')
    expect(failed).toBeTruthy()
    expect(failed!.errorMessage).toContain('解析失败')
  })

  it('首次返回空 content、第二次返回合法 JSON：重试成功，serverFetch 调用 2 次，日志既有失败也有成功', async () => {
    mocks.mockServerFetch
      .mockResolvedValueOnce(okJsonResponse(''))
      .mockResolvedValueOnce(okJsonResponse(VALID_CONTENT))

    const res = await generateLearningContent('Hello world.')

    expect(res.success).toBe(true)
    expect(res.translation).toBe('中文翻译')
    expect(mocks.mockServerFetch).toHaveBeenCalledTimes(2)
    // 第一次尝试的空内容被补记为失败
    expect(
      failureLogs().some(
        (e) => e.operation === 'generateContent' && e.errorMessage?.includes('未返回有效内容'),
      ),
    ).toBe(true)
    // 第二次尝试成功
    expect(
      mocks.mockLog.mock.calls.some(
        ([entry]) => entry.success === true && entry.operation === 'generateContent',
      ),
    ).toBe(true)
  })

  it('两次都返回空 content：最终 success=false，serverFetch 调用 2 次', async () => {
    mocks.mockServerFetch.mockResolvedValue(okJsonResponse(''))

    const res = await generateLearningContent('Hello world.')

    expect(res.success).toBe(false)
    expect(mocks.mockServerFetch).toHaveBeenCalledTimes(2)
  })

  it('请求体 max_tokens 等于 getDeepseekParams() 返回的 contentMaxTokens（4000）', async () => {
    await generateLearningContent('Hello world.')

    const [, options] = mocks.mockServerFetch.mock.calls[0]!
    const body = JSON.parse(options.body)
    expect(body.max_tokens).toBe(4000)
  })
})

describe('generateTitle', () => {
  it('content 为空：返回 success=false，补记 success=false（operation generateTitle），serverFetch 调用 2 次', async () => {
    mocks.mockServerFetch.mockResolvedValue(okJsonResponse(''))

    const res = await generateTitle('Hello world.')

    expect(res.success).toBe(false)
    expect(res.error).toBe('AI 未返回有效内容')
    expect(mocks.mockServerFetch).toHaveBeenCalledTimes(2)
    const failed = failureLogs().find((e) => e.operation === 'generateTitle')
    expect(failed).toBeTruthy()
    expect(failed!.errorMessage).toContain('未返回有效内容')
  })

  it('首次返回空 content、第二次返回标题：重试成功', async () => {
    mocks.mockServerFetch
      .mockResolvedValueOnce(okJsonResponse(''))
      .mockResolvedValueOnce(okJsonResponse('我的标题'))

    const res = await generateTitle('Hello world.')

    expect(res.success).toBe(true)
    expect(res.title).toBe('我的标题')
    expect(mocks.mockServerFetch).toHaveBeenCalledTimes(2)
  })
})
