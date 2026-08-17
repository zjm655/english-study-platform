import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { annotateSpeakers, hasExistingSpeakerMarks } from '../speakerAnnotator'

const mocks = vi.hoisted(() => ({
  mockServerFetch: vi.fn(),
  mockWithQueue: vi.fn(),
  mockLog: vi.fn(),
}))

vi.mock('#server/utils/request', () => ({ serverFetch: mocks.mockServerFetch }))
vi.mock('#server/utils/cloudServiceLog', () => ({ logCloudServiceCall: mocks.mockLog }))
vi.mock('./serviceQueue', () => ({
  withQueue: mocks.mockWithQueue ?? ((_k: string, fn: () => Promise<unknown>) => fn()),
}))

function okJson(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockServerFetch.mockReset()
  mocks.mockWithQueue.mockReset()
  mocks.mockWithQueue.mockImplementation((_k: string, fn: () => Promise<unknown>) => fn())
  vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  vi.stubGlobal('useRuntimeConfig', () => ({
    deepseek: { apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('annotateSpeakers', () => {
  it('判定为对话且返回标注文本', async () => {
    mocks.mockServerFetch.mockResolvedValue(
      okJson(JSON.stringify({ dialogue: true, annotated: 'A: Hi\nB: Hello' })),
    )
    const res = await annotateSpeakers('Hi', 'Hello')
    expect(res.dialogue).toBe(true)
    expect(res.annotated).toBe('A: Hi\nB: Hello')
    const [, options] = mocks.mockServerFetch.mock.calls[0]!
    expect(options.body).toContain('Hi')
  })

  it('判定非对话：annotated 为 null', async () => {
    mocks.mockServerFetch.mockResolvedValue(okJson(JSON.stringify({ dialogue: false })))
    const res = await annotateSpeakers('some monologue', 'text')
    expect(res.dialogue).toBe(false)
    expect(res.annotated).toBeNull()
  })

  it('dialogue=true 但标注为空：annotated 为 null', async () => {
    mocks.mockServerFetch.mockResolvedValue(okJson(JSON.stringify({ dialogue: true, annotated: '' })))
    const res = await annotateSpeakers('a', 'b')
    expect(res.dialogue).toBe(true)
    expect(res.annotated).toBeNull()
  })

  it('JSON 解析失败：返回非对话', async () => {
    mocks.mockServerFetch.mockResolvedValue(okJson('{oops'))
    const res = await annotateSpeakers('a', 'b')
    expect(res.dialogue).toBe(false)
    expect(res.annotated).toBeNull()
    expect(res.skipped).toBe(false)
  })
})

describe('hasExistingSpeakerMarks', () => {
  it('识别 A:/B: 标记对话', () => {
    expect(hasExistingSpeakerMarks('A: Hi\nB: Hello')).toBe(true)
  })

  it('识别人名加冒号的标记对话', () => {
    expect(hasExistingSpeakerMarks('Tom: good morning\nJerry: hi')).toBe(true)
  })

  it('连续散文不触发', () => {
    expect(hasExistingSpeakerMarks('This is a simple narration about the weather.')).toBe(false)
  })

  it('单个标签行（如 Note: ...）不触发', () => {
    expect(hasExistingSpeakerMarks('Note: something only noted once.')).toBe(false)
  })

  it('空文本不触发', () => {
    expect(hasExistingSpeakerMarks('')).toBe(false)
  })
})

describe('annotateSpeakers 预检短路', () => {
  it('原文已含说话人标记：跳过 DeepSeek 并返回 skipped=true', async () => {
    const res = await annotateSpeakers('Hi', 'A: Hi\nB: Hello')
    expect(res.dialogue).toBe(true)
    expect(res.annotated).toBeNull()
    expect(res.skipped).toBe(true)
    expect(mocks.mockServerFetch).not.toHaveBeenCalled()
  })
})