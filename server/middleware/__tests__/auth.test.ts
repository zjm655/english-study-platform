/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import authMiddleware from '../auth'
import { ALL_PERMISSIONS } from '#shared/utils/permission'

// 中间件级测试：覆盖封禁/销号即时拦截（deleted_at→401、status=0→403）、正常放行、admin 门禁。
// verifyToken/getCookie/deleteCookie/validateError/defineEventHandler 均为 Nuxt 自动导入，
// 在 vitest node 环境手动挂全局。

const mocks = vi.hoisted(() => {
  const mockVerifyToken = vi.fn()
  const mockQuery = vi.fn()
  const mockDeleteCookie = vi.fn()
  const mockGetUserPermissions = vi.fn()
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getCookie = (event: any, name: string) => event.__cookies?.[name]
  ;(globalThis as any).deleteCookie = mockDeleteCookie
  ;(globalThis as any).validateError = (message: string, code: number = 400) => ({
    code,
    message,
    data: undefined,
  })
  ;(globalThis as any).verifyToken = mockVerifyToken
  ;(globalThis as any).getRequestIP = () => '127.0.0.1'
  return { mockVerifyToken, mockQuery, mockDeleteCookie, mockGetUserPermissions }
})

vi.mock('#server/utils/db', () => ({ query: mocks.mockQuery }))
// 直接 mock 权限模块：控制 getUserPermissions 返回值，并避免真实 permission.ts 透传引入 oss.ts（顶层 useRuntimeConfig 崩溃）
vi.mock('#server/utils/permission', () => ({ getUserPermissions: mocks.mockGetUserPermissions }))

// 完全 mock 掉 rateLimiter：限流默认关闭（enabled: false），不干扰 auth 中间件核心逻辑测试
vi.mock('#server/utils/rateLimiter', () => ({
  getRateLimitConfig: vi
    .fn()
    .mockResolvedValue({ enabled: false, ipLevel: false, userLevel: false }),
  checkUserRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}))

// ============ 辅助 ============

function makeEvent(token?: string) {
  return {
    path: '/api/units',
    context: {},
    __cookies: token ? { token } : {},
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  // 默认管理员无额外权限；需要时单测内 mockResolvedValueOnce 覆盖
  mocks.mockGetUserPermissions.mockResolvedValue(new Set())
})

// ============ 用例 ============

describe('auth 中间件 - 封禁/销号即时拦截', () => {
  it('未登录（无 token）→ 401', async () => {
    const res = await authMiddleware(makeEvent())
    expect(res!.code).toBe(401)
  })

  it('已注销用户（deleted_at 非空）→ 401 并清除 Cookie', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 5, nickname: 'n', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, status: 1, deleted_at: '2026-01-01' }])
    const res = await authMiddleware(makeEvent('tk'))
    expect(res!.code).toBe(401)
    expect(res!.message).toContain('注销')
    expect(mocks.mockDeleteCookie).toHaveBeenCalled()
  })

  it('封禁用户（status=0）→ 403 并清除 Cookie', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 5, nickname: 'n', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, status: 0, deleted_at: null }])
    const res = await authMiddleware(makeEvent('tk'))
    expect(res!.code).toBe(403)
    expect(res!.message).toContain('封禁')
    expect(mocks.mockDeleteCookie).toHaveBeenCalled()
  })

  it('正常用户 → 放行并挂载 user（role 以 DB 为准）', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 5, nickname: 'n', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 5, role: 1, status: 1, deleted_at: null }])
    const event = makeEvent('tk')
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user.id).toBe(5)
    expect(event.context.user.role).toBe(1)
  })

  it('普通用户访问 /api/admin/* → 403', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 5, nickname: 'n', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, status: 1, deleted_at: null }])
    const event = makeEvent('tk')
    event.path = '/api/admin/user'
    const res = await authMiddleware(event)
    expect(res!.code).toBe(403)
  })
})

describe('auth 中间件 - 超级管理员/权限注入', () => {
  it('超管（role=2）放行并注入 ALL_PERMISSIONS 哨兵，且不查权限表', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 9, nickname: 'su', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 9, role: 2, status: 1, deleted_at: null }])
    const event = makeEvent('tk')
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user.role).toBe(2)
    expect(event.context.user.permissions).toEqual(ALL_PERMISSIONS)
    // 超管走 role 短路，不应查 user_permission 表
    expect(mocks.mockGetUserPermissions).not.toHaveBeenCalled()
  })

  it('超管访问 /api/admin/* → 放行（非 403）', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 9, nickname: 'su', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 9, role: 2, status: 1, deleted_at: null }])
    const event = makeEvent('tk')
    event.path = '/api/admin/user'
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
  })

  it('管理员（role=1）注入其权限表查询结果', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 7, nickname: 'a', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 7, role: 1, status: 1, deleted_at: null }])
    mocks.mockGetUserPermissions.mockResolvedValueOnce(new Set(['manage_materials']))
    const event = makeEvent('tk')
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user.permissions).toContain('manage_materials')
    expect(mocks.mockGetUserPermissions).toHaveBeenCalledWith(7)
  })
})
