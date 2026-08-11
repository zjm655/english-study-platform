/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../upload.post'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：覆盖 C1（multipart 字符串 unitId 强转）、C3（isPublic 默认）、
// S5（输入上限）与越权 403。走真实 adminUploadSchema（不 mock validate）。
// 异步化后 handler 调 enqueueAdminMaterial（入队回执）而非同步 processAdminMaterial。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
})

const { mockReadFormData, mockEnqueueAdminMaterial, mockProcessAdminBatch } = vi.hoisted(() => ({
  mockReadFormData: vi.fn(),
  mockEnqueueAdminMaterial: vi.fn(),
  mockProcessAdminBatch: vi.fn(),
}))

vi.mock('h3', () => ({ readFormData: mockReadFormData }))
vi.mock('#server/services/adminUpload', () => ({
  enqueueAdminMaterial: mockEnqueueAdminMaterial,
  processAdminBatch: mockProcessAdminBatch,
}))
// textParser 为纯函数，re-export 真实实现（resolveUploadTitle/extractInlineTitle 由 handler 同步段使用）
vi.mock('#server/utils/textParser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#server/utils/textParser')>()
  return { ...actual }
})
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ oss: { bucket: 'test-bucket' } }) }))
// upload.post 透过 permission.ts 引入 db.ts / oss.ts（两者模块顶层读 useRuntimeConfig），node 测试需 mock
vi.mock('#server/utils/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))

// ============ 辅助 ============

function makeEvent(user: unknown) {
  return { context: { user } } as any
}

function makeFormData(fields: Record<string, unknown>) {
  return {
    get: (key: string) => (key in fields ? fields[key] : null),
    getAll: (key: string) => (key in fields ? fields[key] : []),
  }
}

const ADMIN = { id: 1, role: 1, permissions: [PERMISSIONS.MANAGE_MATERIALS] }

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ 权限（越权 403） ============

describe('管理员上传接口 - 权限', () => {
  it('非管理员调用返回 403', async () => {
    const res = await handler(makeEvent({ id: 2, role: 0 }))
    expect(res.code).toBe(403)
    expect(mockEnqueueAdminMaterial).not.toHaveBeenCalled()
  })

  it('未登录（无 user）返回 403', async () => {
    const res = await handler(makeEvent(undefined))
    expect(res.code).toBe(403)
  })
})

// ============ C1/C3：multipart 字符串入参 ============

describe('管理员上传接口 - 入参强转（C1/C3 回归）', () => {
  it('C1：unitId 字符串 "0" 经 handler 不再 400，且以数字 0 传入 pipeline', async () => {
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        textContent: 'This is a valid material text content.',
        title: null,
        audio: null,
      }),
    )
    mockEnqueueAdminMaterial.mockResolvedValue({ success: true, recordId: 100, title: 'T' })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    expect(mockEnqueueAdminMaterial).toHaveBeenCalledTimes(1)
    const arg = mockEnqueueAdminMaterial.mock.calls[0]![0]
    expect(arg.unitId).toBe(0)
    expect(arg.isPublic).toBe(1)
  })

  it('C3：isPublic 缺失时默认公开 1', async () => {
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '2',
        voice: 'en-US-AriaNeural',
        textContent: 'Another valid material text content here.',
        title: null,
        audio: null,
      }),
    )
    mockEnqueueAdminMaterial.mockResolvedValue({ success: true, recordId: 101, title: 'T2' })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    expect(mockEnqueueAdminMaterial.mock.calls[0]![0].isPublic).toBe(1)
  })
})

// ============ titleMode：同步段标题解析 ============

describe('管理员上传接口 - titleMode 标题解析', () => {
  it('inline 模式：提取 # 首行为标题并清理正文', async () => {
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        titleMode: 'inline',
        textContent: '# My Title\n\nThe weather is nice today. She went to the park.',
        title: null,
        audio: null,
      }),
    )
    mockEnqueueAdminMaterial.mockResolvedValue({ success: true, recordId: 200, title: 'My Title' })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    const arg = mockEnqueueAdminMaterial.mock.calls[0]![0]
    expect(arg.title).toBe('My Title')
    expect(arg.textContent).toContain('The weather is nice today')
    expect(arg.textContent).not.toContain('# My Title')
    expect(arg.titleMode).toBe('inline')
  })

  it('filename 模式：用文件名（去扩展名）作标题', async () => {
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        titleMode: 'filename',
        fileName: 'A Day at the Park.txt',
        textContent: 'The weather is nice today. She went to the park.',
        title: null,
        audio: null,
      }),
    )
    mockEnqueueAdminMaterial.mockResolvedValue({
      success: true,
      recordId: 201,
      title: 'A Day at the Park',
    })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    const arg = mockEnqueueAdminMaterial.mock.calls[0]![0]
    expect(arg.title).toBe('A Day at the Park')
    expect(res.data?.results?.[0]?.notice).toBeUndefined()
  })

  it('filename 超 50 字符：截取并回执携带 notice', async () => {
    const longName = 'x'.repeat(60) + '.txt'
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        titleMode: 'filename',
        fileName: longName,
        textContent: 'The weather is nice today. She went to the park.',
        title: null,
        audio: null,
      }),
    )
    mockEnqueueAdminMaterial.mockResolvedValue({
      success: true,
      recordId: 202,
      title: 'x'.repeat(50),
    })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    const arg = mockEnqueueAdminMaterial.mock.calls[0]![0]
    expect(arg.title).toBe('x'.repeat(50))
    expect(res.data?.results?.[0]?.notice).toContain('截取')
  })

  it('manual 模式：使用用户填写标题；未填返回 400', async () => {
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        titleMode: 'manual',
        title: 'My Manual Title',
        textContent: 'The weather is nice today. She went to the park.',
        audio: null,
      }),
    )
    mockEnqueueAdminMaterial.mockResolvedValue({
      success: true,
      recordId: 203,
      title: 'My Manual Title',
    })

    const res = await handler(makeEvent(ADMIN))
    expect(res.code).toBe(200)
    expect(mockEnqueueAdminMaterial.mock.calls[0]![0].title).toBe('My Manual Title')

    // 未填标题
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        titleMode: 'manual',
        title: null,
        textContent: 'The weather is nice today. She went to the park.',
        audio: null,
      }),
    )
    const res2 = await handler(makeEvent(ADMIN))
    expect(res2.code).toBe(400)
  })
})

// ============ S5：输入上限 ============

describe('管理员上传接口 - 输入上限（S5）', () => {
  it('single 模式 textContent 少于 10 字符返回 400', async () => {
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'single',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        textContent: 'short',
        title: null,
        audio: null,
      }),
    )
    const res = await handler(makeEvent(ADMIN))
    expect(res.code).toBe(400)
    expect(mockEnqueueAdminMaterial).not.toHaveBeenCalled()
  })

  it('batch 模式超过 20 个文件返回 400', async () => {
    const files = Array.from({ length: 21 }, () => ({}))
    mockReadFormData.mockResolvedValue(
      makeFormData({
        mode: 'batch',
        unitId: '0',
        voice: 'en-US-AriaNeural',
        isPublic: '1',
        files,
      }),
    )
    const res = await handler(makeEvent(ADMIN))
    expect(res.code).toBe(400)
    expect(mockProcessAdminBatch).not.toHaveBeenCalled()
  })
})
