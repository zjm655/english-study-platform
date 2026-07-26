/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runMaterialJob } from '../materialJob'

// ===== materialJob 测试 =====
// 覆盖：成功链路 / 审核拒绝 / TTS 失败 / 事务失败清理栈回滚 / catch-all 永不外抛

const {
  mockModerateText,
  mockRecognizeSpeech,
  mockTextToSpeech,
  mockTtsWithRetry,
  mockUploadWithKey,
  mockDeleteObject,
  mockExtractAudioMeta,
  mockGenerateLearningContent,
  mockGenerateTitle,
  mockPoolExecute,
  mockWithTransaction,
} = vi.hoisted(() => ({
  mockModerateText: vi.fn(),
  mockRecognizeSpeech: vi.fn(),
  mockTextToSpeech: vi.fn(),
  mockTtsWithRetry: vi.fn(),
  mockUploadWithKey: vi.fn(),
  mockDeleteObject: vi.fn(),
  mockExtractAudioMeta: vi.fn(),
  mockGenerateLearningContent: vi.fn(),
  mockGenerateTitle: vi.fn(),
  mockPoolExecute: vi.fn(),
  mockWithTransaction: vi.fn(),
}))

vi.mock('../contentModeration', () => ({ moderateText: mockModerateText }))
vi.mock('../sttFiletrans', () => ({ recognizeSpeech: mockRecognizeSpeech }))
vi.mock('../tts', () => ({ textToSpeech: mockTextToSpeech }))
vi.mock('../ttsRetry', () => ({ ttsWithRetry: mockTtsWithRetry }))
vi.mock('../oss', () => ({ uploadWithKey: mockUploadWithKey, deleteObject: mockDeleteObject }))
vi.mock('../audioMeta', () => ({ extractAudioMeta: mockExtractAudioMeta }))
vi.mock('../aiContent', () => ({
  generateLearningContent: mockGenerateLearningContent,
  generateTitle: mockGenerateTitle,
}))
vi.mock('../db', () => ({
  pool: { execute: mockPoolExecute },
  withTransaction: mockWithTransaction,
}))
vi.mock('node:crypto', () => ({ randomUUID: vi.fn().mockReturnValue('mock-uuid') }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const FAKE_AUDIO = Buffer.from('fake-mp3-data')

const BASE_PARAMS = {
  recordId: 7,
  userId: 1,
  isAdmin: false,
  textContent: 'This is a test material for the pipeline with enough length.',
  voice: 'en-US-AriaNeural',
  isPublic: 1,
  unitId: 0,
}

function setupDefaults() {
  ;(globalThis as any).useRuntimeConfig = () => ({ oss: { bucket: 'test-bucket' } })
  ;(globalThis as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  mockPoolExecute.mockImplementation(async (sql: string) => {
    if (sql.startsWith('INSERT')) return [{ insertId: 100, affectedRows: 1 }]
    return [{ affectedRows: 1 }]
  })
  mockModerateText.mockResolvedValue({ safe: true, reason: null })
  mockTextToSpeech.mockResolvedValue({ success: true, audio: FAKE_AUDIO })
  mockTtsWithRetry.mockResolvedValue({ success: true, audio: FAKE_AUDIO })
  mockUploadWithKey.mockResolvedValue(undefined)
  mockDeleteObject.mockResolvedValue(undefined)
  mockExtractAudioMeta.mockResolvedValue({ duration: 60, size: FAKE_AUDIO.length })
  mockGenerateLearningContent.mockResolvedValue({
    success: true,
    translation: '译文',
    vocabulary: [{ word: 'test', meaning: '测试' }],
    questions: [{ question: 'Q', options: ['A', 'B'], answer: 'A' }],
  })
  mockGenerateTitle.mockResolvedValue({ success: true, title: 'AI Title' })
  mockWithTransaction.mockImplementation(async (fn: any) => {
    const conn = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO segment')) return [{ insertId: 55 }]
        return [{ insertId: 200 }]
      }),
    }
    return fn(conn)
  })
}

/** 汇总 pool.execute 调用中对 record 状态的更新 */
function recordStatusUpdates(): string[] {
  return mockPoolExecute.mock.calls
    .filter(([sql]) => String(sql).includes('material_upload_record'))
    .map(([sql]) => String(sql))
}

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaults()
})

describe('runMaterialJob', () => {
  it('成功链路（TTS 合成）：queued→processing→success，segment 入库', async () => {
    await runMaterialJob({ ...BASE_PARAMS })

    const updates = recordStatusUpdates()
    expect(updates.some((s) => s.includes("'processing'"))).toBe(true)
    expect(updates.some((s) => s.includes("'success'"))).toBe(true)
    expect(mockTextToSpeech).toHaveBeenCalledWith(BASE_PARAMS.textContent, BASE_PARAMS.voice)
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    // 成功后不清理 OSS
    expect(mockDeleteObject).not.toHaveBeenCalled()
  })

  it('用户上传音频链路：先传 OSS 再走 STT + 二次审核，不调 TTS 合成正文', async () => {
    mockRecognizeSpeech.mockResolvedValue({ success: true, text: BASE_PARAMS.textContent })
    await runMaterialJob({
      ...BASE_PARAMS,
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'user.mp3',
    })
    expect(mockRecognizeSpeech).toHaveBeenCalled()
    // OSS 上传前移：STT 调用时收到已上传的 ossKey
    expect(mockRecognizeSpeech.mock.calls[0]![0].ossKey).toBeTruthy()
    expect(mockUploadWithKey).toHaveBeenCalled()
    expect(mockTextToSpeech).not.toHaveBeenCalled()
    expect(recordStatusUpdates().some((s) => s.includes("'success'"))).toBe(true)
  })

  it('用户音频时长超限：meta 前移校验，不触发 OSS 上传与 STT（不烧 filetrans 额度）', async () => {
    mockExtractAudioMeta.mockResolvedValue({ duration: 200, size: 1000 })
    await runMaterialJob({
      ...BASE_PARAMS,
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'user.mp3',
    })
    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    expect(mockUploadWithKey).not.toHaveBeenCalled()
    expect(mockRecognizeSpeech).not.toHaveBeenCalled()
  })

  it('OSS 上传后 STT 失败：清理栈删除已上传的主音频对象', async () => {
    mockRecognizeSpeech.mockResolvedValue({ success: false, error: '识别失败' })
    await runMaterialJob({
      ...BASE_PARAMS,
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'user.mp3',
    })
    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    // 主音频已上传即登记清理栈，STT 失败后被删除
    expect(mockUploadWithKey).toHaveBeenCalledTimes(1)
    expect(mockDeleteObject).toHaveBeenCalledTimes(1)
  })

  it('文本审核不通过：failed 且不进入后续流水线', async () => {
    mockModerateText.mockResolvedValue({ safe: false, reason: '包含违规内容' })
    await runMaterialJob({ ...BASE_PARAMS })

    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    expect(mockTextToSpeech).not.toHaveBeenCalled()
    expect(mockUploadWithKey).not.toHaveBeenCalled()
  })

  it('TTS 失败：failed 且携带失败原因', async () => {
    mockTextToSpeech.mockResolvedValue({ success: false, error: 'TTS 转换超时' })
    await runMaterialJob({ ...BASE_PARAMS })

    const failedCall = mockPoolExecute.mock.calls.find(([sql]) => String(sql).includes("'failed'"))
    expect(failedCall).toBeTruthy()
    expect(String(failedCall![1])).toContain('音频生成失败')
  })

  it('事务失败：清理栈删除主音频与词汇音频 OSS 对象 + media 禁用 + failed', async () => {
    mockWithTransaction.mockRejectedValue(new Error('db down'))
    await runMaterialJob({ ...BASE_PARAMS })

    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    // 主音频 + 1 个词汇音频均被清理
    expect(mockDeleteObject).toHaveBeenCalledTimes(2)
    // media 禁用
    expect(
      mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes('UPDATE media SET status')),
    ).toBe(true)
  })

  it('未预期异常（AI 模块抛错）：catch-all 兜底写 failed，绝不外抛', async () => {
    mockGenerateLearningContent.mockRejectedValue(new Error('boom'))
    await expect(runMaterialJob({ ...BASE_PARAMS })).resolves.toBeUndefined()
    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
  })

  it('音频时长超限（用户档 180s）：failed', async () => {
    mockExtractAudioMeta.mockResolvedValue({ duration: 200, size: 1000 })
    await runMaterialJob({ ...BASE_PARAMS })
    const failedCall = mockPoolExecute.mock.calls.find(([sql]) => String(sql).includes("'failed'"))
    expect(String(failedCall![1])).toContain('超过限制')
  })

  it('事务提交后 success 写入报错：不误伤已入库资源，重试补写 success', async () => {
    let successCalls = 0
    mockPoolExecute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("'success'")) {
        successCalls++
        if (successCalls === 1) throw new Error('network blip')
        return [{ affectedRows: 1 }]
      }
      if (String(sql).startsWith('INSERT')) return [{ insertId: 100, affectedRows: 1 }]
      return [{ affectedRows: 1 }]
    })

    await expect(runMaterialJob({ ...BASE_PARAMS })).resolves.toBeUndefined()

    // 重试了一次 success 补写
    expect(successCalls).toBe(2)
    // 绝不清理 OSS / 禁用 media / 写 failed
    expect(mockDeleteObject).not.toHaveBeenCalled()
    expect(mockPoolExecute.mock.calls.some(([sql]) => String(sql).includes("'failed'"))).toBe(false)
    expect(
      mockPoolExecute.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE media SET status = 0'),
      ),
    ).toBe(false)
  })
})
