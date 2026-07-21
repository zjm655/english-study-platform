import { describe, it, expect, vi, beforeEach } from 'vitest'

// handler 级集成测试：覆盖管理员用户管理的权限门禁（403）、列表 state/keyword 过滤、
// 封禁护栏（自己/管理员）、销号 affectedRows、资料修改 email 查重。走真实 validate schema。

vi.hoisted(() => {
  // Nuxt 自动导入的符号在 vitest node 环境需手动挂全局
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
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
vi.mock('h3', () => ({ readBody: mockReadBody }))

import listHandler from '../index.get'
import putHandler from '../[userId].put'
import statusHandler from '../[userId]/status.put'
import deleteHandler from '../[userId].delete'

// ============ 辅助 ============

const ADMIN = { id: 1, role: 1 }

function makeEvent(opts: { user?: unknown; query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {}) {
  return {
    context: { user: opts.user },
    __query: opts.query,
    __params: opts.params,
    __body: opts.body,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReadBody.mockImplementation(async (event: any) => event.__body)
})

// ============ 权限门禁（403） ============

describe('管理员用户接口 - 权限', () => {
  it('非管理员调用列表/编辑/封禁/销号均返回 403', async () => {
    const user = { id: 2, role: 0 }
    expect((await listHandler(makeEvent({ user }))).code).toBe(403)
    expect((await putHandler(makeEvent({ user, params: { userId: '5' }, body: {} }))).code).toBe(403)
    expect((await statusHandler(makeEvent({ user, params: { userId: '5' }, body: { status: 0 } }))).code).toBe(403)
    expect((await deleteHandler(makeEvent({ user, params: { userId: '5' } }))).code).toBe(403)
  })
})

// ============ 列表：state 过滤 + keyword 搜索 ============

describe('管理员用户列表 - 过滤与搜索', () => {
  it('state=banned 时 WHERE 含 status=0 且排除已注销', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    const res = await listHandler(makeEvent({ user: ADMIN, query: { state: 'banned' } }))
    expect(res.code).toBe(200)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('deleted_at IS NULL')
    expect(sql).toContain('status = 0')
  })

  it('state=deleted 时 WHERE 为 deleted_at IS NOT NULL', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    await listHandler(makeEvent({ user: ADMIN, query: { state: 'deleted' } }))
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('deleted_at IS NOT NULL')
    expect(sql).not.toContain('deleted_at IS NULL')
  })

  it('keyword 以 LIKE 参数化搜索账号/昵称', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    await listHandler(makeEvent({ user: ADMIN, query: { keyword: '张' } }))
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('account LIKE ?')
    expect(sql).toContain('nickname LIKE ?')
    const params = mockQuery.mock.calls[0]![1]
    expect(params).toContain('%张%')
  })
})

// ============ 封禁：护栏 ============

describe('管理员封禁/解封 - 护栏', () => {
  it('封禁自己返回 400', async () => {
    const res = await statusHandler(makeEvent({ user: ADMIN, params: { userId: '1' }, body: { status: 0 } }))
    expect(res.code).toBe(400)
    expect(res.message).toContain('不能封禁自己')
  })

  it('封禁管理员返回 400', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, role: 1, status: 1, account: 'admin2' }])
    const res = await statusHandler(makeEvent({ user: ADMIN, params: { userId: '5' }, body: { status: 0 } }))
    expect(res.code).toBe(400)
    expect(res.message).toContain('管理员')
  })

  it('封禁成功返回 200 并写操作日志', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, status: 1, account: 'user5' }])
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    const res = await statusHandler(makeEvent({ user: ADMIN, params: { userId: '5' }, body: { status: 0 } }))
    expect(res.code).toBe(200)
    expect(mockLogAdminOperation).toHaveBeenCalledWith(1, 'user.ban', 'user', 5, expect.anything())
  })
})

// ============ 销号：软删除 ============

describe('管理员销号', () => {
  it('销号自己返回 400', async () => {
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { userId: '1' } }))
    expect(res.code).toBe(400)
  })

  it('affectedRows=0（已注销）返回 404', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, account: 'user5' }])
    mockQuery.mockResolvedValueOnce({ affectedRows: 0 })
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { userId: '5' } }))
    expect(res.code).toBe(404)
  })

  it('销号成功返回 200，SQL 置 deleted_at', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, role: 0, account: 'user5' }])
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { userId: '5' } }))
    expect(res.code).toBe(200)
    const sql = mockQuery.mock.calls[1]![0] as string
    expect(sql).toContain('deleted_at = NOW()')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(1, 'user.delete', 'user', 5, expect.anything())
  })
})

// ============ 资料修改：email 查重 ============

describe('管理员资料修改', () => {
  const target = { id: 5, nickname: '旧昵称', email: 'old@example.com', level: 1 }

  it('email 改为已被他人使用的值返回 400', async () => {
    mockQuery.mockResolvedValueOnce([target])
    mockQuery.mockResolvedValueOnce([{ id: 9 }])   // 查重命中
    const res = await putHandler(makeEvent({ user: ADMIN, params: { userId: '5' }, body: { email: 'dup@example.com' } }))
    expect(res.code).toBe(400)
    expect(res.message).toContain('邮箱')
  })

  it('修改成功返回 200，动态 UPDATE 含传入字段', async () => {
    mockQuery.mockResolvedValueOnce([target])
    mockQuery.mockResolvedValueOnce([])            // 查重未命中
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    const res = await putHandler(makeEvent({
      user: ADMIN,
      params: { userId: '5' },
      body: { nickname: '新昵称', email: 'new@example.com', level: 2 },
    }))
    expect(res.code).toBe(200)
    const sql = mockQuery.mock.calls[2]![0] as string
    expect(sql).toContain('nickname = ?')
    expect(sql).toContain('email = ?')
    expect(sql).toContain('level = ?')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(1, 'user.update', 'user', 5, expect.anything())
  })

  it('无任何修改字段返回 400', async () => {
    mockQuery.mockResolvedValueOnce([target])
    const res = await putHandler(makeEvent({ user: ADMIN, params: { userId: '5' }, body: {} }))
    expect(res.code).toBe(400)
  })
})
