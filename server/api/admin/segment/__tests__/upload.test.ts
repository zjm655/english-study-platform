/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../upload.post'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：覆盖 C1（multipart 字符串 unitId 强转）、C3（isPublic 默认）、
// S5（输入上限）与越权 403。走真实 adminUploadSchema（不 mock validate），堵住旧测试
// 直调 processAdminMaterial（传数字）绕过 handler 的盲区。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
})

const { mockReadFormData, mockProcessAdminMaterial, mockProcessAdminBatch } = vi.hoisted(() => ({
  mockReadFormData: vi.fn(),
  mockProcessAdminMaterial: vi.fn(),
  mockProcessAdminBatch: vi.fn(),
}))

vi.mock('h3', () => ({ readFormData: mockReadFormData }))
vi.mock('#server/utils/adminUpload', () => ({
  processAdminMaterial: mockProcessAdminMaterial,
  processAdminBatch: mockProcessAdminBatch,
}))
vi.mock('#server/utils/textParser', () => ({ parseTxtFile: vi.fn() }))
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
    expect(mockProcessAdminMaterial).not.toHaveBeenCalled()
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
    mockProcessAdminMaterial.mockResolvedValue({ success: true, segmentId: 100, title: 'T' })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    expect(mockProcessAdminMaterial).toHaveBeenCalledTimes(1)
    const arg = mockProcessAdminMaterial.mock.calls[0]![0]
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
    mockProcessAdminMaterial.mockResolvedValue({ success: true, segmentId: 101, title: 'T2' })

    const res = await handler(makeEvent(ADMIN))

    expect(res.code).toBe(200)
    expect(mockProcessAdminMaterial.mock.calls[0]![0].isPublic).toBe(1)
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
    expect(mockProcessAdminMaterial).not.toHaveBeenCalled()
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
