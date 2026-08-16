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
  mockDownloadObject,
  mockExtractAudioMeta,
  mockGenerateLearningContent,
  mockGenerateTitle,
  mockPoolExecute,
  mockWithTransaction,
  mockIsUploadQueueFull,
  mockRecognizeSpeech,
  mockModerateText,
  mockCompareTextSimilarity,
  mockFileLog,
  mockGetUploadLimits,
} = vi.hoisted(() => {
  const mockTextToSpeech = vi.fn()
  const mockUploadWithKey = vi.fn()
  const mockDeleteObject = vi.fn()
  const mockDownloadObject = vi.fn()
  const mockExtractAudioMeta = vi.fn()
  const mockGenerateLearningContent = vi.fn()
  const mockGenerateTitle = vi.fn()
  const mockPoolExecute = vi.fn()
  const mockWithTransaction = vi.fn()
  const mockIsUploadQueueFull = vi.fn()
  const mockRecognizeSpeech = vi.fn()
  const mockModerateText = vi.fn()
  const mockCompareTextSimilarity = vi.fn()
  const mockFileLog = vi.fn()
  const mockGetUploadLimits = vi.fn()
  return {
    mockTextToSpeech: mockTextToSpeech,
    mockUploadWithKey: mockUploadWithKey,
    mockDeleteObject: mockDeleteObject,
    mockDownloadObject: mockDownloadObject,
    mockExtractAudioMeta: mockExtractAudioMeta,
    mockGenerateLearningContent: mockGenerateLearningContent,
    mockGenerateTitle: mockGenerateTitle,
    mockPoolExecute: mockPoolExecute,
    mockWithTransaction: mockWithTransaction,
    mockIsUploadQueueFull: mockIsUploadQueueFull,
    mockRecognizeSpeech: mockRecognizeSpeech,
    mockModerateText: mockModerateText,
    mockCompareTextSimilarity: mockCompareTextSimilarity,
    mockFileLog: mockFileLog,
    mockGetUploadLimits: mockGetUploadLimits,
  }
})

// Mock 外部依赖
vi.mock('../tts', () => ({ textToSpeech: mockTextToSpeech }))
vi.mock('#server/utils/oss', () => ({
  uploadWithKey: mockUploadWithKey,
  deleteObject: mockDeleteObject,
  downloadObject: mockDownloadObject,
}))
// materialJob 仅提供队列深度检查，mock 掉避免拉入其完整依赖链（STT/审核等）
vi.mock('../materialJob', () => ({ isUploadQueueFull: mockIsUploadQueueFull }))
vi.mock('#server/utils/audioMeta', () => ({ extractAudioMeta: mockExtractAudioMeta }))
vi.mock('../aiContent', () => ({
  generateLearningContent: mockGenerateLearningContent,
  generateTitle: mockGenerateTitle,
}))
// NLS 校对链路：STT 识别 / 音频文本审核 / 相似度对比
vi.mock('../sttFiletrans', () => ({ recognizeSpeech: mockRecognizeSpeech }))
vi.mock('../contentModeration', () => ({ moderateText: mockModerateText }))
vi.mock('#server/utils/textSimilarity', () => ({
  compareTextSimilarity: mockCompareTextSimilarity,
}))
vi.mock('#server/utils/db', () => ({
  pool: { execute: mockPoolExecute },
  withTransaction: mockWithTransaction,
}))
// 文本长度校验依赖 getUploadLimits（sys_config），mock 返回受控档位（默认值）；
// validateUploadText 为纯函数，保留真实实现
vi.mock('#server/utils/uploadLimitChecker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#server/utils/uploadLimitChecker')>()
  return { ...actual, getUploadLimits: mockGetUploadLimits }
})
vi.mock('#server/utils/fileLogger', () => ({
  fileLog: mockFileLog,
  fileLogError: vi.fn(),
}))
vi.mock('node:crypto', () => ({ randomUUID: vi.fn().mockReturnValue('mock-uuid') }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ============ 辅助 ============

const FAKE_AUDIO = Buffer.from('fake-mp3-data')

function setupDefaults() {
  mockIsUploadQueueFull.mockResolvedValue(false)
  mockGetUploadLimits.mockResolvedValue({
    maxAudioDurationUser: 180,
    maxAudioDurationAdmin: 600,
    maxAudioSizeUser: 2097152,
    maxAudioSizeAdmin: 5242880,
    recordingMaxSize: 52428800,
    uploadQueueMax: 50,
    minTextUser: 10,
    maxTextUser: 5000,
    minTextAdmin: 10,
    maxTextAdmin: 5000,
  })
  mockPoolExecute.mockImplementation(async (sql: string) => {
    if (sql.startsWith('INSERT')) return [{ insertId: 1, affectedRows: 1 }]
    return [[]]
  })
  mockTextToSpeech.mockResolvedValue({ success: true, audio: FAKE_AUDIO })
  mockUploadWithKey.mockResolvedValue(undefined)
  mockDownloadObject.mockResolvedValue(FAKE_AUDIO)
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

  it('带 audioBuffer 的对话文本放行（主音频不依赖 TTS，允许对话）', async () => {
    setupDefaults()

    const dialogue = 'Alice: Hello\nBob: Hi there\nAlice: How are you?\nBob: Fine'
    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: dialogue,
      title: 'Dialogue Material',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'test.mp3',
    })

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    // 主音频不 TTS 合成
    expect(mockTextToSpeech).not.toHaveBeenCalledWith(dialogue, expect.anything())
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

  it("titleMode='manual' 且 title 为空：不调用 generateTitle，降级文本截取", async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Some manual text content here.',
      title: null,
      titleMode: 'manual',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(true)
    expect(mockGenerateTitle).not.toHaveBeenCalled()
    expect(result.title).toBe('Some manual text content here.')
  })

  it("titleMode='text_filename' 且 title 为空：不调用 generateTitle，降级文本截取", async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Filename titled material text.',
      title: null,
      titleMode: 'text_filename',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(true)
    expect(mockGenerateTitle).not.toHaveBeenCalled()
    expect(result.title).toBe('Filename titled material text.')
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

  it('有音频时跳过 TTS，主音频不再重复上传（同步段已持久化）', async () => {
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
    // 主音频已在同步段持久化，此处不重复上传（仅词汇音频上传，key 前缀 audio/vocab/）
    expect(
      mockUploadWithKey.mock.calls.every(([, key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
  })

  it('仅传 audioOssKey（重处理复用）：下载音频、跳过主音频 TTS、复用 key 入库', async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Reprocess persisted audio.',
      title: 'Repro',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioOssKey: 'audio/material/persisted.mp3',
    })

    expect(result.success).toBe(true)
    expect(mockDownloadObject).toHaveBeenCalledWith('audio/material/persisted.mp3')
    // 主音频不重新合成（词汇 TTS 仍会调用，检查材料文本参数）
    expect(mockTextToSpeech).not.toHaveBeenCalledWith(
      'Reprocess persisted audio.',
      expect.anything(),
    )
    // media 记录复用持久化 key
    const mediaInsert = mockPoolExecute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO media'),
    )
    expect(mediaInsert).toBeTruthy()
    expect(mediaInsert![1]).toContain('audio/material/persisted.mp3')
    // 主音频不重复上传
    expect(
      mockUploadWithKey.mock.calls.every(([, key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
  })

  it('持久化音频下载失败：整单失败且不调主音频 TTS、不清理', async () => {
    setupDefaults()
    mockDownloadObject.mockRejectedValue(new Error('oss down'))

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Reprocess audio unavailable.',
      title: 'Gone',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioOssKey: 'audio/material/gone.mp3',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('原音频不可用')
    expect(mockTextToSpeech).not.toHaveBeenCalled()
    expect(mockDeleteObject).not.toHaveBeenCalled()
  })

  it('nlsCheck=false（默认）时有音频也不调用 STT', async () => {
    setupDefaults()

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Audio without nls check.',
      title: 'No NLS',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'test.mp3',
    })

    expect(result.success).toBe(true)
    expect(mockRecognizeSpeech).not.toHaveBeenCalled()
  })

  it('nlsCheck=true 且含音频：执行 STT 校对，segment 写入 nls_check=1', async () => {
    setupDefaults()
    mockRecognizeSpeech.mockResolvedValue({ success: true, text: 'recognized text here' })
    mockModerateText.mockResolvedValue({ safe: true, reason: null })
    mockCompareTextSimilarity.mockReturnValue({ passed: true, score: 0.95 })

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Audio with nls check enabled.',
      title: 'NLS On',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'test.mp3',
      nlsCheck: true,
    })

    expect(result.success).toBe(true)
    expect(mockRecognizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'mp3', ossKey: expect.any(String) }),
    )
    expect(mockModerateText).toHaveBeenCalledWith('recognized text here')
    expect(mockCompareTextSimilarity).toHaveBeenCalled()
    // 事务内 segment INSERT 含 nls_check=1
    const segInsert = mockWithTransaction.mock.calls[0]![0].toString()
    expect(segInsert).toContain('nls_check')
  })

  it('nlsCheck=true 且 STT 失败：整单失败并走清理栈（不调用 AI）', async () => {
    setupDefaults()
    mockRecognizeSpeech.mockResolvedValue({ success: false, error: '识别超时' })

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Audio will fail stt.',
      title: 'NLS Fail',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'test.mp3',
      nlsCheck: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('音频识别失败')
    expect(mockGenerateLearningContent).not.toHaveBeenCalled()
    // 主音频已在同步段持久化，STT 失败不清理持久化 key（保留供重处理复用），仅记录标 failed
    expect(mockDeleteObject).not.toHaveBeenCalled()
    expect(mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes("'failed'"))).toBe(true)
  })

  it('nlsCheck=true 且相似度不匹配：整单失败', async () => {
    setupDefaults()
    mockRecognizeSpeech.mockResolvedValue({ success: true, text: 'completely different audio' })
    mockModerateText.mockResolvedValue({ safe: true, reason: null })
    mockCompareTextSimilarity.mockReturnValue({ passed: false, score: 0.3 })

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Expected text content.',
      title: 'Sim Fail',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'test.mp3',
      nlsCheck: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('不匹配')
  })

  it('AI 内容生成失败：返回 error 与 error_message 均透传具体原因', async () => {
    setupDefaults()
    mockGenerateLearningContent.mockResolvedValue({
      success: false,
      error: 'AI 生成内容解析失败',
    })

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Normal text for ai failure.',
      title: 'Test',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('AI 内容生成失败: AI 生成内容解析失败')
    // record 的 error_message 同样携带具体原因（可诊断）
    const failedCall = mockPoolExecute.mock.calls.find(([sql]) => String(sql).includes("'failed'"))
    expect(failedCall).toBeTruthy()
    expect(String(failedCall![1])).toContain('AI 内容生成失败: AI 生成内容解析失败')
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
    // AI 失败降级需记录 ai 文件日志
    expect(mockFileLog).toHaveBeenCalledWith(
      'ai',
      'warn',
      expect.stringContaining('标题生成失败'),
      expect.any(Object),
    )
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
    // TTS 合成路径的主音频 key 会进入清理栈
    expect(
      mockDeleteObject.mock.calls.some(([key]) => String(key).startsWith('audio/material/')),
    ).toBe(true)
    // media 禁用
    expect(
      mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE media SET status')),
    ).toBe(true)
    // record 标 failed
    expect(mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes("'failed'"))).toBe(true)
  })

  it('持久化音频任务失败（事务失败）：主音频 key 保留不清理，仅词汇孤儿被清', async () => {
    setupDefaults()
    mockWithTransaction.mockRejectedValue(new Error('db down'))

    const result = await processAdminMaterial({
      userId: 1,
      unitId: 1,
      textContent: 'Persisted audio transaction failure.',
      title: 'Test',
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      audioOssKey: 'audio/material/persisted.mp3',
    })

    expect(result.success).toBe(false)
    // 词汇音频 key 仍被清理（1 个词汇），主音频持久化 key 绝不被删（保留供重处理复用）
    expect(mockDeleteObject).toHaveBeenCalledTimes(1)
    expect(
      mockDeleteObject.mock.calls.every(([key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
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

  it('批量处理多个 txt 文件，单个失败不中断；默认 ai 模式标题不再取自首行', async () => {
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
    // 无 titleMode → 默认 ai：title=null（首行不再是标题），入队记录标题 = 文本截取（前 50 字符）
    expect(result[1]!.success).toBe(true)
    expect(result[1]!.title).toBe('Daily Weather\nThe weather is nice today.')
    expect(result[2]!.success).toBe(true)
    expect(result[2]!.title).toBe('Science News\nScientists found something new.')
  })

  it('inline 模式：正文首行 `# ` 提取为标题并从正文移除', async () => {
    setupDefaults()

    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [{ name: 'story.txt', content: '# My Title\nRest of the story content here.' }],
      titleMode: 'inline',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.success).toBe(true)
    expect(result[0]!.title).toBe('My Title')
  })

  it('text_filename 模式：文件名去扩展名作为标题', async () => {
    setupDefaults()

    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [{ name: 'abc.txt', content: 'Some content for abc.' }],
      titleMode: 'text_filename',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.success).toBe(true)
    expect(result[0]!.title).toBe('abc')
  })

  it('text_filename 模式：超长文件名截取 50 字符并附 notice', async () => {
    setupDefaults()

    const longName = 'a'.repeat(60)
    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [{ name: `${longName}.txt`, content: 'Some content here.' }],
      titleMode: 'text_filename',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.success).toBe(true)
    expect(result[0]!.title).toBe('a'.repeat(50))
    expect(result[0]!.notice).toBe('标题超过 50 字符，已截取')
    // text_filename 截取需记录 ai 文件日志
    expect(mockFileLog).toHaveBeenCalledWith(
      'ai',
      'warn',
      expect.stringContaining('50字符'),
      expect.objectContaining({ fileName: `${longName}.txt` }),
    )
  })

  it('文本超过上限：拒绝该文件（不建记录不入队）', async () => {
    setupDefaults()

    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [{ name: 'too-long.txt', content: 'a'.repeat(5001) }],
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.success).toBe(false)
    expect(result[0]!.error).toContain('5000')
    // 拒绝路径不建记录（无 INSERT 调用）
    expect(
      mockPoolExecute.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT')),
    ).toBe(false)
  })

  it('文本少于下限：拒绝该文件', async () => {
    setupDefaults()

    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [{ name: 'too-short.txt', content: 'hi' }],
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.success).toBe(false)
    expect(result[0]!.error).toContain('10')
    expect(
      mockPoolExecute.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT')),
    ).toBe(false)
  })

  it('文本校验在标题提取之后执行：inline 提取后正文过短也拒绝', async () => {
    setupDefaults()

    const result = await processAdminBatch({
      userId: 1,
      unitId: 1,
      voice: 'en-US-AriaNeural',
      isPublic: 1,
      bucket: 'test-bucket',
      files: [{ name: 'title-only.txt', content: '# A Very Long Title Line Here\nhi' }],
      titleMode: 'inline',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.success).toBe(false)
    expect(result[0]!.error).toContain('10')
  })
})
