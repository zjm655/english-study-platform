/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../visibility.put'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：审核门禁——材料公开状态调整 visibility.put。
// 覆盖 无 REVIEW→403 不查库、非受限材料→400、缺 reason→400 不查库、留痕失败→500 不 UPDATE、成功→UPDATE + 返回 isPublic。
// 走真实 permission.ts（ensurePermission/writeReviewAccessLog），mock db/adminLog/oss/h3。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery, mockReadBody, mockLogAdminOperation } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockReadBody: vi.fn(),
  mockLogAdminOperation: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/adminLog', () => ({ logAdminOperation: mockLogAdminOperation }))
// permission.ts 透传引入 oss.ts（模块顶层读 useRuntimeConfig），node 测试环境需 mock 避免崩溃
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))
vi.mock('h3', () => ({ readBody: mockReadBody, getRequestIP: () => '10.0.0.1' }))

const REVIEWER = { id: 1, role: 1, permissions: [PERMISSIONS.REVIEW] }
const VALID_BODY = { isPublic: 1, reasonCategory: '质量抽查', reason: '核实内容合规' }

function makeEvent(opts: { user?: unknown; params?: Record<string, string>; body?: unknown } = {}) {
  return { context: { user: opts.user }, __params: opts.params, __body: opts.body } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReadBody.mockImplementation(async (event: any) => event.__body)
})

describe('审核门禁 - 材料公开状态调整 visibility.put', () => {
  it('无 REVIEW 权限 → 403，且不查库', async () => {
    const res = await handler(
      makeEvent({ user: { id: 2, role: 0 }, params: { segId: '5' }, body: VALID_BODY }),
    )
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('缺 reason → 400，且不查库不 UPDATE', async () => {
    const res = await handler(
      makeEvent({
        user: REVIEWER,
        params: { segId: '5' },
        body: { isPublic: 1, reasonCategory: '质量抽查' },
      }),
    )
    expect(res.code).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('非受限材料（系统/管理员材料）→ 400，且不留痕不 UPDATE', async () => {
    // uploader_user_id 为 null → 视为系统/管理员材料，uploaderIsAdmin=true → 非受限
    mockQuery.mockResolvedValueOnce([{ is_public: 0, uploader_user_id: null, uploader_role: null }])
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { segId: '5' }, body: VALID_BODY }),
    )
    expect(res.code).toBe(400)
    // 仅 SELECT 一次，无留痕 INSERT / 无 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('留痕失败 → 500，且绝不 UPDATE（安全优先）', async () => {
    mockQuery.mockResolvedValueOnce([{ is_public: 0, uploader_user_id: 9, uploader_role: 0 }]) // SELECT 受限
    mockQuery.mockRejectedValueOnce(new Error('insert fail')) // writeReviewAccessLog
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { segId: '5' }, body: VALID_BODY }),
    )
    expect(res.code).toBe(500)
    // SELECT + 留痕(失败) = 2 次，未执行 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockLogAdminOperation).not.toHaveBeenCalled()
  })

  it('成功：留痕后才 UPDATE，返回 isPublic 并写操作日志', async () => {
    mockQuery.mockResolvedValueOnce([{ is_public: 0, uploader_user_id: 9, uploader_role: 0 }]) // SELECT 受限
    mockQuery.mockResolvedValueOnce({ insertId: 1 }) // writeReviewAccessLog
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { segId: '5' }, body: VALID_BODY }),
    )
    expect(res.code).toBe(200)
    expect(res.data!.isPublic).toBe(1)
    // 第 3 次为 UPDATE segment is_public
    const [updateSql] = mockQuery.mock.calls[2]!
    expect(updateSql).toContain('UPDATE segment')
    expect(updateSql).toContain('is_public')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      1,
      'segment.visibility.update',
      'segment',
      5,
      expect.anything(),
    )
  })
})
