/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import authMiddleware from '../auth'
import { ALL_PERMISSIONS } from '#shared/utils/permission'
import { isPublicReadPath } from '../../utils/publicRead'

// 中间件级测试：覆盖封禁/销号即时拦截（deleted_at→401、status=0→403）、正常放行、admin 门禁、
// 公开只读路径可选鉴权。
// verifyToken/getCookie/deleteCookie/validateError/defineEventHandler/isPublicReadPath 均为
// Nuxt/Nitro 自动导入，在 vitest node 环境手动挂全局。

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
  // getRequestIP 已随 P3-A 收口到 getClientIp（显式 import h3），不再走 globalThis；
  // 测试 event 无 node.req 时 getClientIp 返回 'unknown'（限流 mock 已放行，语义无影响）
  return { mockVerifyToken, mockQuery, mockDeleteCookie, mockGetUserPermissions }
})

vi.mock('#server/utils/db', () => ({ query: mocks.mockQuery }))
// 直接 mock 权限模块：控制 getUserPermissions 返回值，并避免真实 permission.ts 透传引入 oss.ts（顶层 useRuntimeConfig 崩溃）
vi.mock('#server/services/permission', () => ({ getUserPermissions: mocks.mockGetUserPermissions }))

// 完全 mock 掉 rateLimiter：限流默认关闭（enabled: false），不干扰 auth 中间件核心逻辑测试
vi.mock('#server/utils/rateLimiter', () => ({
  getRateLimitConfig: vi
    .fn()
    .mockResolvedValue({ enabled: false, ipLevel: false, userLevel: false }),
  checkUserRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}))

// isPublicReadPath 在中间件内是 Nitro 自动导入：挂真实实现（纯函数，无需 mock）
;(globalThis as any).isPublicReadPath = isPublicReadPath

// ============ 辅助 ============

function makeEvent(token?: string) {
  return {
    // 默认用非公开路径：/api/units 已是可选鉴权公开路径，无 token 会被放行
    path: '/api/user/stats',
    method: 'GET',
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

describe('auth 中间件 - 公开只读路径可选鉴权', () => {
  it('游客 GET /api/units → 放行且不挂 user', async () => {
    const event = makeEvent()
    event.path = '/api/units?level=1'
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user).toBeUndefined()
  })

  it('游客 GET /api/units/:id/progress → 放行且不挂 user', async () => {
    const event = makeEvent()
    event.path = '/api/units/3/progress'
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user).toBeUndefined()
  })

  it('游客 POST /api/units → 仍 401（仅放行 GET）', async () => {
    const event = makeEvent()
    event.path = '/api/units'
    event.method = 'POST'
    const res = await authMiddleware(event)
    expect(res!.code).toBe(401)
  })

  it('持 token 访问 GET /api/units → 走完整验证并挂载 user（登录形态不变）', async () => {
    mocks.mockVerifyToken.mockResolvedValue({ id: 5, nickname: 'n', email: 'e' })
    mocks.mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, status: 1, deleted_at: null }])
    const event = makeEvent('tk')
    event.path = '/api/units'
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user.id).toBe(5)
  })

  it('持坏 token 访问 GET /api/units → 仍 401+清 cookie（行为与现状一致）', async () => {
    mocks.mockVerifyToken.mockRejectedValue(new Error('bad token'))
    const event = makeEvent('bad')
    event.path = '/api/units'
    const res = await authMiddleware(event)
    expect(res!.code).toBe(401)
    expect(mocks.mockDeleteCookie).toHaveBeenCalled()
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

describe('auth 中间件 - 游客写端点白名单与 payload.id 防线', () => {
  it('无 token PUT /api/guest/study-time → 放行且不挂 user', async () => {
    const event = makeEvent()
    event.method = 'PUT'
    event.path = '/api/guest/study-time'
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
    expect(event.context.user).toBeUndefined()
  })

  it('无 token PUT /api/guest/study-time?x=1（带 query）→ 仍放行（剥 query 匹配）', async () => {
    const event = makeEvent()
    event.method = 'PUT'
    event.path = '/api/guest/study-time?x=1'
    const res = await authMiddleware(event)
    expect(res).toBeUndefined()
  })

  it('无 token GET /api/guest/study-time → 仍 401（仅放行 PUT）', async () => {
    const event = makeEvent()
    event.method = 'GET'
    event.path = '/api/guest/study-time'
    const res = await authMiddleware(event)
    expect(res!.code).toBe(401)
  })

  it('token 验签通过但 payload.id 非 number（游客 token 冒充）→ 401+清 cookie', async () => {
    // 游客 token 无 id 字段；若被塞进 token cookie，不能以 undefined 绑参查库
    mocks.mockVerifyToken.mockResolvedValue({ gk: 'abc', typ: 'guest' })
    const event = makeEvent('guesttk')
    const res = await authMiddleware(event)
    expect(res!.code).toBe(401)
    expect(mocks.mockDeleteCookie).toHaveBeenCalled()
    // 未成功拦截时绝不查库（防 undefined 绑参）
    expect(mocks.mockQuery).not.toHaveBeenCalled()
  })
})
