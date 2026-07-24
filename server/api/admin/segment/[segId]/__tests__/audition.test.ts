/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../audition.post'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：审核门禁——材料（segment）试听解锁。
// 覆盖 无 REVIEW→403、材料不存在→404、缺 reason→400 不签名、留痕失败→500 不签名、成功→签名。
// 走真实 permission.ts（ensurePermission/auditionUnlock），mock db/oss/h3。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery, mockSignUrl, mockReadBody } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSignUrl: vi.fn(),
  mockReadBody: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/oss', () => ({ signUrl: mockSignUrl, MATERIAL_EXPIRE: 2100 }))
vi.mock('h3', () => ({ readBody: mockReadBody, getRequestIP: () => '10.0.0.1' }))

const REVIEWER = { id: 1, role: 1, permissions: [PERMISSIONS.REVIEW] }

function makeEvent(opts: { user?: unknown; params?: Record<string, string> } = {}) {
  return { context: { user: opts.user }, __params: opts.params } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('审核门禁 - 材料试听解锁 audition.post', () => {
  it('无 REVIEW 权限 → 403，且不查库', async () => {
    const res = await handler(makeEvent({ user: { id: 2, role: 0 }, params: { segId: '5' } }))
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('材料不存在或已删除 → 404', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await handler(makeEvent({ user: REVIEWER, params: { segId: '999' } }))
    expect(res.code).toBe(404)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('缺 reason → 400，且绝不签名', async () => {
    mockQuery.mockResolvedValueOnce([{ media_key: 'k', media_duration: 10, uploader_user_id: 9 }])
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查' })
    const res = await handler(makeEvent({ user: REVIEWER, params: { segId: '5' } }))
    expect(res.code).toBe(400)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('留痕失败 → 500，且绝不签名（安全优先）', async () => {
    mockQuery.mockResolvedValueOnce([{ media_key: 'k', media_duration: 10, uploader_user_id: 9 }]) // SELECT
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容' })
    mockQuery.mockRejectedValueOnce(new Error('insert fail')) // writeReviewAccessLog
    const res = await handler(makeEvent({ user: REVIEWER, params: { segId: '5' } }))
    expect(res.code).toBe(500)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('成功：留痕后才签名，返回 audioUrl + duration', async () => {
    mockQuery.mockResolvedValueOnce([
      { media_key: 'obj/k.mp3', media_duration: 8, uploader_user_id: 9 },
    ])
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容' })
    mockQuery.mockResolvedValueOnce({ insertId: 1 })
    mockSignUrl.mockResolvedValueOnce('https://signed-seg')
    const res = await handler(makeEvent({ user: REVIEWER, params: { segId: '5' } }))
    expect(res.code).toBe(200)
    expect(res.data!.audioUrl).toBe('https://signed-seg')
    expect(res.data!.duration).toBe(8)
  })
})
