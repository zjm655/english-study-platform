/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../status.get'
import adminHandler from '../../../admin/material/records/status.get'
import { PERMISSIONS } from '#shared/utils/permission'

// ===== 批量状态查询端点测试 =====
// 覆盖：未登录 401 / ids 非法 400 / 用户端强制 user_id 过滤 / 管理端权限 403 与全量查询

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getQuery = (event: any) => event._query ?? {}
})

const { mockFetchRecordStatuses } = vi.hoisted(() => ({ mockFetchRecordStatuses: vi.fn() }))
vi.mock('#server/services/materialRecordStatus', () => ({
  fetchRecordStatuses: mockFetchRecordStatuses,
}))
// 端点经 validate/permission 间接触达 db/oss（模块顶层读 useRuntimeConfig），node 测试需 mock
vi.mock('#server/utils/db', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))

function makeEvent(user: unknown, query: Record<string, unknown> = {}) {
  return { context: { user }, _query: query } as any
}

const USER = { id: 42, role: 0 }
const ADMIN = { id: 1, role: 1, permissions: [PERMISSIONS.MANAGE_MATERIALS] }

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchRecordStatuses.mockResolvedValue([])
})

describe('GET /api/material/records/status', () => {
  it('未登录返回 401', async () => {
    const res = await handler(makeEvent(undefined, { ids: '1' }))
    expect(res.code).toBe(401)
    expect(mockFetchRecordStatuses).not.toHaveBeenCalled()
  })

  it('ids 缺失/非法返回 400', async () => {
    expect((await handler(makeEvent(USER, {}))).code).toBe(400)
    expect((await handler(makeEvent(USER, { ids: 'a,b' }))).code).toBe(400)
    expect((await handler(makeEvent(USER, { ids: '0' }))).code).toBe(400)
    expect(mockFetchRecordStatuses).not.toHaveBeenCalled()
  })

  it('ids 超过 50 个返回 400', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1).join(',')
    expect((await handler(makeEvent(USER, { ids }))).code).toBe(400)
  })

  it('合法 ids：去重后传入并强制带当前用户 id（防 IDOR）', async () => {
    const res = await handler(makeEvent(USER, { ids: '3,1,3' }))
    expect(res.code).toBe(200)
    expect(mockFetchRecordStatuses).toHaveBeenCalledWith([3, 1], USER.id)
  })
})

describe('GET /api/admin/material/records/status', () => {
  it('非管理员返回 403', async () => {
    const res = await adminHandler(makeEvent(USER, { ids: '1' }))
    expect(res.code).toBe(403)
    expect(mockFetchRecordStatuses).not.toHaveBeenCalled()
  })

  it('管理员合法查询：不带用户过滤（查所有）', async () => {
    const res = await adminHandler(makeEvent(ADMIN, { ids: '5,6' }))
    expect(res.code).toBe(200)
    expect(mockFetchRecordStatuses).toHaveBeenCalledWith([5, 6])
  })
})
