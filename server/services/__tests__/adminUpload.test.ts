/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { processAdminMaterial, processAdminBatch } from '../adminUpload'

// ===== adminUpload 测试 =====
// TDD: 先于 adminUpload.ts 编写，预期全部失败

// 使用 vi.hoisted 确保 mock 引用在 vi.mock 提升之前可用
const {
  mockTextToSpeech,
  mockUploadWithKey,
  mockDeleteObject,
  mockExtractAudioMeta,
  mockGenerateLearningContent,
  mockGenerateTitle,
  mockPoolExecute,
  mockWithTransaction,
  mockIsUploadQueueFull,
} = vi.hoisted(() => {
  const mockTextToSpeech = vi.fn()
  const mockUploadWithKey = vi.fn()
  const mockDeleteObject = vi.fn()
  const mockExtractAudioMeta = vi.fn()
  const mockGenerateLearningContent = vi.fn()
  const mockGenerateTitle = vi.fn()
  const mockPoolExecute = vi.fn()
  const mockWithTransaction = vi.fn()
  const mockIsUploadQueueFull = vi.fn()
  return {
    mockTextToSpeech: mockTextToSpeech,
    mockUploadWithKey: mockUploadWithKey,
    mockDeleteObject: mockDeleteObject,
    mockExtractAudioMeta: mockExtractAudioMeta,
    mockGenerateLearningContent: mockGenerateLearningContent,
    mockGenerateTitle: mockGenerateTitle,
    mockPoolExecute: mockPoolExecute,
    mockWithTransaction: mockWithTransaction,
    mockIsUploadQueueFull: mockIsUploadQueueFull,
  }
})

// Mock 外部依赖
vi.mock('../tts', () => ({ textToSpeech: mockTextToSpeech }))
vi.mock('#server/utils/oss', () => ({
  uploadWithKey: mockUploadWithKey,
  deleteObject: mockDeleteObject,
}))
// materialJob 仅提供队列深度检查，mock 掉避免拉入其完整依赖链（STT/审核等）
vi.mock('../materialJob', () => ({ isUploadQueueFull: mockIsUploadQueueFull }))
vi.mock('#server/utils/audioMeta', () => ({ extractAudioMeta: mockExtractAudioMeta }))
vi.mock('../aiContent', () => ({
  generateLearningContent: mockGenerateLearningContent,
  generateTitle: mockGenerateTitle,
}))
vi.mock('#server/utils/db', () => ({
  pool: { execute: mockPoolExecute },
  withTransaction: mockWithTransaction,
}))
vi.mock('node:crypto', () => ({ randomUUID: vi.fn().mockReturnValue('mock-uuid') }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ============ 辅助 ============

const FAKE_AUDIO = Buffer.from('fake-mp3-data')

function setupDefaults() {
  mockIsUploadQueueFull.mockResolvedValue(false)
  mockPoolExecute.mockImplementation(async (sql: string) => {
    if (sql.startsWith('INSERT')) return [{ insertId: 1, affectedRows: 1 }]
    return [[]]
  })
  mockTextToSpeech.mockResolvedValue({ success: true, audio: FAKE_AUDIO })
  mockUploadWithKey.mockResolvedValue(undefined)
  mockExtractAudioMeta.mockResolvedValue({ duration: 30.5, size: 1024 })
  mockGenerateLearningContent.mockResolvedValue({
    success: true,
    translation: '翻译文本',
    vocabulary: [
      {
        word: 'important',
        forms: 'important, importantly',
        phonetic: '/ɪmˈpɔːrtənt/',
        meaning: '重要的',
        exampleSentence: 'This is important.',
        exampleTranslation: '这很重要。',
      },
    ],
    questions: [
      {
        question: 'What does "important" mean?',
        options: ['A. 重要的', 'B. 不重要的', 'C. 大的', 'D. 小的'],
        answer: 'A. 重要的',
      },
    ],
  })
  mockGenerateTitle.mockResolvedValue({ success: true, title: 'AI 生成标题' })
  mockWithTransaction.mockImplementation(async (fn: (conn: any) => Promise<any>) => {
    const mockConn = { execute: vi.fn().mockResolvedValue([{ insertId: 100 }]) }
    return fn(mockConn)
  })
}

// ============ processAdminMaterial ============

describe('processAdminMaterial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('对话文本应返回 success: false', async () => {
    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Alice: Hello\nBob: Hi there\nAlice: How are you?\nBob: Fine',
      title: 'Test',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('对话')
    expect(mockTextToSpeech).not.toHaveBeenCalled()
  })

  it('无音频时完整成功路径', async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 2,
      textContent: 'The weather is nice today. She went to the park.',
      title: null,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(true)
    expect(result.segmentId).toBe(100)
    expect(result.title).toBe('AI 生成标题')
    expect(mockTextToSpeech).toHaveBeenCalled()
    expect(mockUploadWithKey).toHaveBeenCalled()
    expect(mockGenerateLearningContent).toHaveBeenCalled()
    expect(mockGenerateTitle).toHaveBeenCalled()
  })

  it('有指定标题时不应调用 generateTitle', async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 2,
      textContent: 'Some text here.',
      title: 'My Custom Title',
      voice: 'en-US-AriaNeural',
      isPublic: 0,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe('My Custom Title')
    expect(mockGenerateTitle).not.toHaveBeenCalled()
  })

  it('TTS 失败应返回错误', async () => {
    mockPoolExecute.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT')) return [{ insertId: 1, affectedRows: 1 }]
      return [[]]
    })
    mockTextToSpeech.mockResolvedValue({ success: false, audio: null })

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Normal text.',
      title: 'Test',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('音频生成')
  })

  it('有音频时跳过 TTS，直接上传 OSS', async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'User provided audio text.',
      title: 'With Audio',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'test.mp3',
    })

    expect(result.success).toBe(true)
    // 有音频时不应调用材料级 TTS（词汇 TTS 仍会调用，所以检查材料文本参数）
    expect(mockTextToSpeech).not.toHaveBeenCalledWith(
      'User provided audio text.',
      expect.anything(),
    )
    expect(mockUploadWithKey).toHaveBeenCalled()
  })

  it('AI 标题生成失败时降级为文本截取', async () => {
    setupDefaults()
    mockGenerateTitle.mockResolvedValue({ success: false, error: 'LLM error' })

    const longText = 'A'.repeat(80)
    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: longText,
      title: null,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(true)
    expect(result.title).toBe(longText.slice(0, 50) + '...')
  })

  it('事务失败：清理栈删除主音频与词汇音频 OSS 对象 + media 禁用 + failed', async () => {
    setupDefaults()
    mockWithTransaction.mockRejectedValue(new Error('db down'))

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Normal text for transaction failure.',
      title: 'Test',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(false)
    // 主音频 + 1 个词汇音频均被清理
    expect(mockDeleteObject).toHaveBeenCalledTimes(2)
    // media 禁用
    expect(
      mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE media SET status')),
    ).toBe(true)
    // record 标 failed
    expect(mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes("'failed'"))).toBe(true)
  })

  it('事务提交后 success 写入报错：不误伤已入库资源，重试补写 success', async () => {
    setupDefaults()
    let successCalls = 0
    mockPoolExecute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("'success'")) {
        successCalls++
        if (successCalls === 1) throw new Error('network blip')
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('INSERT')) return [{ insertId: 1, affectedRows: 1 }]
      return [[]]
    })

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Committed then record write fails.',
      title: 'Test',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    // 提交后失败：仍视为成功，重试了一次 success 补写
    expect(result.success).toBe(true)
    expect(successCalls).toBe(2)
    // 绝不清理 OSS / 禁用 media / 写 failed
    expect(mockDeleteObject).not.toHaveBeenCalled()
    expect(mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes("'failed'"))).toBe(false)
  })
})

// ============ processAdminBatch ============

describe('processAdminBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('批量处理多个 txt 文件，单个失败不中断', async () => {
    setupDefaults()

    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [
        { name: 'dialogue.txt', content: 'Alice: Hello\nBob: Hi' },
        { name: 'article.txt', content: 'Daily Weather\nThe weather is nice today.' },
        { name: 'news.txt', content: 'Science News\nScientists found something new.' },
      ],
    })

    expect(result).toHaveLength(3)
    expect(result[0]!.success).toBe(false)
    expect(result[0]!.error).toContain('对话')
    expect(result[1]!.success).toBe(true)
    expect(result[1]!.title).toBe('Daily Weather')
    expect(result[2]!.success).toBe(true)
    expect(result[2]!.title).toBe('Science News')
  })
})
