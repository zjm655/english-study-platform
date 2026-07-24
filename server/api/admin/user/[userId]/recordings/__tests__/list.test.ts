/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../index.get'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：用户录音记录列表。
// 覆盖 无 MANAGE_USERS→403 不查库、WHERE 恒含 user_id + deleted_at、分数档映射。
// 走真实 permission.ts / validate.ts，mock db。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('#server/utils/db', () => ({ query: mockQuery }))
// permission.ts 依赖 oss.ts（模块加载时读 runtimeConfig），本端点虽不签名仍需 mock 避免加载失败
vi.mock('#server/utils/oss', () => ({
  signUrl: vi.fn(),
  MATERIAL_EXPIRE: 2100,
  RECORDING_EXPIRE: 2400,
}))

const MANAGER = { id: 1, role: 1, permissions: [PERMISSIONS.MANAGE_USERS] }

function makeEvent(
  opts: { user?: unknown; params?: Record<string, string>; query?: Record<string, unknown> } = {},
) {
  return { context: { user: opts.user }, __params: opts.params, __query: opts.query } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQuery.mockResolvedValue([]) // 默认三次查询（list/count/unitOptions）均空
})

describe('用户录音记录列表 index.get', () => {
  it('无 MANAGE_USERS 权限 → 403，且不查库', async () => {
    const res = await handler(
      makeEvent({ user: { id: 2, role: 0 }, params: { userId: '7' }, query: {} }),
    )
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('WHERE 恒含 user_id + deleted_at IS NULL，首参为 userId', async () => {
    const res = await handler(makeEvent({ user: MANAGER, params: { userId: '7' }, query: {} }))
    expect(res.code).toBe(200)
    const [listSql, listParams] = mockQuery.mock.calls[0]!
    expect(listSql).toContain('r.user_id = ?')
    expect(listSql).toContain('r.deleted_at IS NULL')
    expect(listParams[0]).toBe(7)
  })

  it('分数档 high → WHERE 含 r.score >= 80', async () => {
    const res = await handler(
      makeEvent({ user: MANAGER, params: { userId: '7' }, query: { scoreBand: 'high' } }),
    )
    expect(res.code).toBe(200)
    const [listSql] = mockQuery.mock.calls[0]!
    expect(listSql).toContain('r.score >= 80')
  })

  it('分数档 mid → WHERE 含 60–80 区间；low → 含 < 60', async () => {
    await handler(
      makeEvent({ user: MANAGER, params: { userId: '7' }, query: { scoreBand: 'mid' } }),
    )
    expect(mockQuery.mock.calls[0]![0]).toContain('r.score >= 60 AND r.score < 80')
    vi.clearAllMocks()
    mockQuery.mockResolvedValue([])
    await handler(
      makeEvent({ user: MANAGER, params: { userId: '7' }, query: { scoreBand: 'low' } }),
    )
    expect(mockQuery.mock.calls[0]![0]).toContain('r.score < 60')
  })
})
