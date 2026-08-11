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
  mockDownloadObject,
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
  mockDownloadObject: vi.fn(),
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
vi.mock('#server/utils/oss', () => ({
  uploadWithKey: mockUploadWithKey,
  deleteObject: mockDeleteObject,
  downloadObject: mockDownloadObject,
}))
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
  mockDownloadObject.mockResolvedValue(FAKE_AUDIO)
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
    // 主音频合成走带重试的 ttsWithRetry
    expect(mockTtsWithRetry).toHaveBeenCalledWith(BASE_PARAMS.textContent, BASE_PARAMS.voice)
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    // 成功后不清理 OSS
    expect(mockDeleteObject).not.toHaveBeenCalled()
  })

  it('用户上传音频链路：跳过同步上传（已持久化）直接走 STT + 二次审核，不调 TTS 合成正文', async () => {
    mockRecognizeSpeech.mockResolvedValue({ success: true, text: BASE_PARAMS.textContent })
    await runMaterialJob({
      ...BASE_PARAMS,
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'user.mp3',
    })
    expect(mockRecognizeSpeech).toHaveBeenCalled()
    // STT 调用时收到已持久化的 ossKey
    expect(mockRecognizeSpeech.mock.calls[0]![0].ossKey).toBeTruthy()
    expect(mockTextToSpeech).not.toHaveBeenCalled()
    // 主音频已持久化，不重复合成、不重复上传
    expect(mockTtsWithRetry).not.toHaveBeenCalledWith(BASE_PARAMS.textContent, BASE_PARAMS.voice)
    expect(
      mockUploadWithKey.mock.calls.every(([, key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
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

  it('用户上传音频 STT 失败：主音频已持久化，key 保留不清理（供重处理复用）', async () => {
    mockRecognizeSpeech.mockResolvedValue({ success: false, error: '识别失败' })
    await runMaterialJob({
      ...BASE_PARAMS,
      audioBuffer: FAKE_AUDIO,
      audioFileName: 'user.mp3',
    })
    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    // 同步段已上传，主音频不重复上传、失败也不清理持久化 key
    expect(
      mockUploadWithKey.mock.calls.every(([, key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
    expect(mockDeleteObject).not.toHaveBeenCalled()
  })

  it('文本审核不通过：failed 且不进入后续流水线', async () => {
    mockModerateText.mockResolvedValue({ safe: false, reason: '包含违规内容' })
    await runMaterialJob({ ...BASE_PARAMS })

    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    expect(mockTextToSpeech).not.toHaveBeenCalled()
    expect(mockUploadWithKey).not.toHaveBeenCalled()
  })

  it('TTS 失败：failed 且携带失败原因', async () => {
    mockTtsWithRetry.mockResolvedValue({ success: false, error: 'TTS 转换超时' })
    await runMaterialJob({ ...BASE_PARAMS })

    const failedCall = mockPoolExecute.mock.calls.find(([sql]) => String(sql).includes("'failed'"))
    expect(failedCall).toBeTruthy()
    expect(String(failedCall![1])).toContain('音频生成失败')
  })

  it('仅传 audioOssKey（重处理复用）：下载持久化音频、不调主音频 TTS、复用 key 入库', async () => {
    mockRecognizeSpeech.mockResolvedValue({ success: true, text: BASE_PARAMS.textContent })
    await runMaterialJob({ ...BASE_PARAMS, audioOssKey: 'audio/material/persisted.mp3' })

    expect(mockDownloadObject).toHaveBeenCalledWith('audio/material/persisted.mp3')
    // 主音频不重新合成（词汇音频仍会调用 ttsWithRetry，但参数是单词）
    expect(mockTtsWithRetry).not.toHaveBeenCalledWith(BASE_PARAMS.textContent, BASE_PARAMS.voice)
    // media 记录复用持久化 key
    const mediaInsert = mockPoolExecute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO media'),
    )
    expect(mediaInsert).toBeTruthy()
    expect(mediaInsert![1]).toContain('audio/material/persisted.mp3')
    // 不重复上传
    expect(
      mockUploadWithKey.mock.calls.every(([, key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
    expect(recordStatusUpdates().some((s) => s.includes("'success'"))).toBe(true)
  })

  it('持久化音频下载失败：任务失败、error 含「原音频不可用」，不调 TTS、不清理', async () => {
    mockDownloadObject.mockRejectedValue(new Error('oss unavailable'))
    await runMaterialJob({ ...BASE_PARAMS, audioOssKey: 'audio/material/gone.mp3' })

    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    const failedCall = mockPoolExecute.mock.calls.find(([sql]) => String(sql).includes("'failed'"))
    expect(String(failedCall![1])).toContain('原音频不可用')
    expect(mockTtsWithRetry).not.toHaveBeenCalled()
    expect(mockDeleteObject).not.toHaveBeenCalled()
  })

  it('持久化音频任务失败（事务失败）：主音频 key 保留不清理，仅词汇孤儿被清', async () => {
    mockRecognizeSpeech.mockResolvedValue({ success: true, text: BASE_PARAMS.textContent })
    mockWithTransaction.mockRejectedValue(new Error('db down'))
    await runMaterialJob({ ...BASE_PARAMS, audioOssKey: 'audio/material/persisted.mp3' })

    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
    // 词汇音频 key 仍被清理（1 个词汇），主音频持久化 key 绝不被删
    expect(mockDeleteObject).toHaveBeenCalledTimes(1)
    expect(
      mockDeleteObject.mock.calls.every(([key]) => !String(key).startsWith('audio/material/')),
    ).toBe(true)
  })

  it('事务失败：清理栈删除主音频与词汇音频 OSS 对象 + media 禁用 + failed', async () => {
    mockWithTransaction.mockRejectedValue(new Error('db down'))
    await runMaterialJob({ ...BASE_PARAMS })

    expect(recordStatusUpdates().some((s) => s.includes("'failed'"))).toBe(true)
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
