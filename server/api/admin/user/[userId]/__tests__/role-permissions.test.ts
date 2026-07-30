/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import roleHandler from '../role.put'
import permHandler from '../permissions.put'

// handler 级集成测试：权限分配硬规则。
// role.put：schema 拒 role=2（不可经 API 升超管）、目标为超管→403（受保护）。
// permissions.put：仅可为管理员授权（普通用户→400、管理员→200 覆盖式写入）。
// 走真实 validate/permission.ts，mock db/adminLog/oss/h3。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery, mockWithTransaction, mockConnExecute, mockReadBody, mockLogAdminOperation } =
  vi.hoisted(() => ({
    mockQuery: vi.fn(),
    mockWithTransaction: vi.fn(),
    mockConnExecute: vi.fn(),
    mockReadBody: vi.fn(),
    mockLogAdminOperation: vi.fn(),
  }))

vi.mock('#server/utils/db', () => ({ query: mockQuery, withTransaction: mockWithTransaction }))
vi.mock('#server/services/adminLog', () => ({ logAdminOperation: mockLogAdminOperation }))
// permission.ts 透传引入 oss.ts（模块顶层读 useRuntimeConfig），node 测试环境需 mock 避免崩溃
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))
vi.mock('h3', () => ({ readBody: mockReadBody }))

// 授权者须持 grant_permissions —— 超管（role=2）经 role 短路隐式全权
const SUPER = { id: 1, role: 2, permissions: [] as string[] }

function makeEvent(opts: { user?: unknown; params?: Record<string, string>; body?: unknown } = {}) {
  return { context: { user: opts.user }, __params: opts.params, __body: opts.body } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTransaction.mockImplementation(async (fn: any) => fn({ execute: mockConnExecute }))
  mockReadBody.mockImplementation(async (event: any) => event.__body)
})

// ============ role.put：超管唯一 + 保护现有超管 ============

describe('管理员角色变更 - 超管规则', () => {
  it('传 role=2（超管）→ 400（schema 拒绝），且不查库', async () => {
    const res = await roleHandler(
      makeEvent({ user: SUPER, params: { userId: '5' }, body: { role: 2 } }),
    )
    expect(res.code).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('目标当前为超管 → 403（受保护，不可变更），且不 UPDATE', async () => {
    mockQuery.mockResolvedValueOnce([{ role: 2 }]) // 目标现为超管
    const res = await roleHandler(
      makeEvent({ user: SUPER, params: { userId: '5' }, body: { role: 0 } }),
    )
    expect(res.code).toBe(403)
    // 仅 SELECT 一次，无 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockLogAdminOperation).not.toHaveBeenCalled()
  })
})

// ============ permissions.put：仅可为管理员授权 ============

describe('管理员权限分配 - 仅管理员可授权', () => {
  it('目标为普通用户(role=0) → 400，且不写库', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, role: 0 }]) // 目标为普通用户
    const res = await permHandler(
      makeEvent({ user: SUPER, params: { userId: '5' }, body: { permissions: ['manage_users'] } }),
    )
    expect(res.code).toBe(400)
    expect(mockWithTransaction).not.toHaveBeenCalled()
    expect(mockLogAdminOperation).not.toHaveBeenCalled()
  })

  it('目标为管理员(role=1) → 200（覆盖式写入 + 写操作日志）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, role: 1 }]) // 目标为管理员
    mockConnExecute.mockResolvedValue([{ affectedRows: 1 }])
    const res = await permHandler(
      makeEvent({
        user: SUPER,
        params: { userId: '5' },
        body: { permissions: ['manage_users', 'view_stats'] },
      }),
    )
    expect(res.code).toBe(200)
    expect(mockWithTransaction).toHaveBeenCalled()
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      1,
      'user.permissions.update',
      'user',
      5,
      expect.anything(),
    )
  })
})
