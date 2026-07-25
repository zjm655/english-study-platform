/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import listHandler from '../index.get'
import createHandler from '../index.post'
import putHandler from '../[unitId].put'
import deleteHandler from '../[unitId].delete'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：覆盖管理员单元 CRUD 的权限门禁（403）、id=0 系统保留单元
// 禁编辑/禁删除、软删除 affectedRows=0 → 404、保存 schema 校验。走真实 validate schema。

vi.hoisted(() => {
  // Nuxt 自动导入的符号在 vitest node 环境需手动挂全局
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery, mockReadBody } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockReadBody: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({
  query: mockQuery,
  withTransaction: vi.fn(),
}))
vi.mock('h3', () => ({ readBody: mockReadBody }))
// permission.ts 透传引入 oss.ts（其模块顶层读 useRuntimeConfig），node 测试环境需 mock 避免崩溃
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))

// ============ 辅助 ============

const ADMIN = { id: 1, role: 1, permissions: [PERMISSIONS.MANAGE_MATERIALS] }

function makeEvent(
  opts: {
    user?: unknown
    query?: Record<string, string>
    params?: Record<string, string>
    body?: unknown
  } = {},
) {
  return {
    context: { user: opts.user },
    __query: opts.query,
    __params: opts.params,
    __body: opts.body,
  } as any
}

const validBody = { title: '新单元', description: '简介', level: 2, sortOrder: 5 }

beforeEach(() => {
  vi.clearAllMocks()
  mockReadBody.mockImplementation(async (event: any) => event.__body)
})

// ============ 权限门禁（403） ============

describe('管理员单元接口 - 权限', () => {
  it('非管理员调用列表/新建/编辑/删除均返回 403', async () => {
    const user = { id: 2, role: 0 }
    expect((await listHandler(makeEvent({ user }))).code).toBe(403)
    expect((await createHandler(makeEvent({ user, body: validBody }))).code).toBe(403)
    expect(
      (await putHandler(makeEvent({ user, params: { unitId: '1' }, body: validBody }))).code,
    ).toBe(403)
    expect((await deleteHandler(makeEvent({ user, params: { unitId: '1' } }))).code).toBe(403)
  })
})

// ============ 列表：参数强转 + 软删过滤 ============

describe('管理员单元列表', () => {
  it('query 字符串参数经 zod coerce 为数字，level=0 是合法筛选值', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // 主查询
      .mockResolvedValueOnce([{ total: 0 }]) // COUNT

    const res = await listHandler(
      makeEvent({ user: ADMIN, query: { page: '2', pageSize: '20', level: '0' } }),
    )

    expect(res.code).toBe(200)
    // 第一次查询的参数：[level, pageSize, offset]，均应为数字
    const params = mockQuery.mock.calls[0]![1]
    expect(params[0]).toBe(0) // level 字符串 '0' → 数字 0
    expect(params[1]).toBe(20) // pageSize
    expect(params[2]).toBe(20) // offset = (2-1)*20
    // WHERE 含软删除过滤，材料数子查询过滤已删材料
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('u.deleted_at IS NULL')
    expect(sql).toContain('s.deleted_at IS NULL')
  })
})

// ============ 新建：schema 校验 ============

describe('管理员新建单元', () => {
  it('title 为空返回 400（schema 拒绝）', async () => {
    const res = await createHandler(makeEvent({ user: ADMIN, body: { ...validBody, title: '' } }))
    expect(res.code).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('level=0 返回 400（0 保留给自定义单元）', async () => {
    const res = await createHandler(makeEvent({ user: ADMIN, body: { ...validBody, level: 0 } }))
    expect(res.code).toBe(400)
  })

  it('成功新建返回 insertId', async () => {
    mockQuery.mockResolvedValueOnce({ insertId: 9 })
    const res = await createHandler(makeEvent({ user: ADMIN, body: validBody }))
    expect(res.code).toBe(200)
    expect(res.data).toEqual({ id: 9 })
  })
})

// ============ 编辑：id=0 保护 + affectedRows ============

describe('管理员编辑单元', () => {
  it('unitId=0 系统保留单元返回 403（不触碰数据库）', async () => {
    const res = await putHandler(
      makeEvent({ user: ADMIN, params: { unitId: '0' }, body: validBody }),
    )
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('unitId 非数字返回 400', async () => {
    const res = await putHandler(
      makeEvent({ user: ADMIN, params: { unitId: 'abc' }, body: validBody }),
    )
    expect(res.code).toBe(400)
  })

  it('单元不存在或已删除返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 0 })
    const res = await putHandler(
      makeEvent({ user: ADMIN, params: { unitId: '999' }, body: validBody }),
    )
    expect(res.code).toBe(404)
  })

  it('成功保存四字段', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    const res = await putHandler(
      makeEvent({ user: ADMIN, params: { unitId: '2' }, body: validBody }),
    )
    expect(res.code).toBe(200)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('UPDATE unit')
    expect(sql).toContain('deleted_at IS NULL')
    expect(params).toEqual(['新单元', '简介', 2, 5, 2])
  })
})

// ============ 软删除：id=0 保护 + affectedRows ============

describe('管理员软删除单元', () => {
  it('unitId=0 系统保留单元返回 403（不触碰数据库）', async () => {
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { unitId: '0' } }))
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('affectedRows=0（不存在或重复删除）返回 404', async () => {
    mockQuery
      .mockResolvedValueOnce([{ total: 0 }]) // 材料数统计
      .mockResolvedValueOnce({ affectedRows: 0 }) // UPDATE
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { unitId: '999' } }))
    expect(res.code).toBe(404)
  })

  it('成功软删除返回 200，SQL 置 deleted_at', async () => {
    mockQuery
      .mockResolvedValueOnce([{ total: 3 }]) // 材料数统计
      .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { unitId: '5' } }))
    expect(res.code).toBe(200)
    const sql = mockQuery.mock.calls[1]![0] as string
    expect(sql).toContain('deleted_at = NOW()')
    expect(sql).toContain('deleted_at IS NULL')
  })
})
