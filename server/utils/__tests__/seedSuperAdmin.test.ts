/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { seedSuperAdmin } from '../seedSuperAdmin'
import { ROLE_ADMIN, ROLE_SUPER_ADMIN } from '#shared/utils/role'

// 单元测试：启动期自举超管核心逻辑。mock db（query + withTransaction）与 bcrypt。
// 覆盖：弱密码/账号超长→抛错、无超管建新、account 占用→抛错、幂等跳过、
// 异账号超管未开关跳过、forceReplace 降级+立新、表缺失 fail-fast。

const { mockQuery, mockWithTransaction, mockConnExecute } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
  mockConnExecute: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery, withTransaction: mockWithTransaction }))
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'HASHED') } }))

const CFG = { account: 'root_admin', password: 'strongpass123' }

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTransaction.mockImplementation(async (fn: any) => fn({ execute: mockConnExecute }))
  mockConnExecute.mockResolvedValue([{ insertId: 10 }])
})

describe('seedSuperAdmin - 配置校验', () => {
  it('密码太弱（<8）→ 抛错，且不查库', async () => {
    await expect(seedSuperAdmin({ account: 'root', password: 'short' })).rejects.toThrow(/太弱/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('account 超长（>20）→ 抛错', async () => {
    await expect(
      seedSuperAdmin({ account: 'x'.repeat(21), password: 'strongpass123' }),
    ).rejects.toThrow(/ACCOUNT/)
  })
})

describe('seedSuperAdmin - 无超管', () => {
  it('account 空闲 → 建新超管（INSERT user + checkin + 留痕），返回 created', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]) // supers=[]、占用查询=[]
    const res = await seedSuperAdmin(CFG)
    expect(res).toEqual({ status: 'created', userId: 10 })
    // 事务内：INSERT user + INSERT checkin + INSERT log = 3 次
    expect(mockConnExecute).toHaveBeenCalledTimes(3)
    const [userSql, userParams] = mockConnExecute.mock.calls[0]!
    expect(userSql).toContain('INSERT INTO `user`')
    expect(userParams).toContain(ROLE_SUPER_ADMIN)
    const [logSql, logParams] = mockConnExecute.mock.calls[2]!
    expect(logSql).toContain('admin_operation_log')
    expect(logParams).toContain('user.superadmin.bootstrap')
  })

  it('account 已被占用 → 抛错，且不进事务', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 9 }]) // supers=[]、占用命中
    await expect(seedSuperAdmin(CFG)).rejects.toThrow(/已被占用/)
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('账号/密码为纯数字（Nuxt destr 转成 number）→ String 归一后正常建新', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]) // supers=[]、占用查询=[]
    // 模拟 env 经 destr：NUXT_SUPER_ADMIN_ACCOUNT=13800138000 → number
    const res = await seedSuperAdmin({ account: 13800138000, password: 12345678 })
    expect(res).toEqual({ status: 'created', userId: 10 })
    const [, userParams] = mockConnExecute.mock.calls[0]!
    expect(userParams[0]).toBe('13800138000') // account 已 String 归一为字符串
  })
})

describe('seedSuperAdmin - 已存在超管', () => {
  it('目标账号已是超管 → 幂等跳过（不写库）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, account: 'root_admin' }])
    const res = await seedSuperAdmin(CFG)
    expect(res).toEqual({ status: 'exists' })
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('异账号超管 + 未开 forceReplace → 跳过（不写库）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, account: 'legacy_admin' }])
    const res = await seedSuperAdmin(CFG)
    expect(res.status).toBe('skipped-conflict')
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('异账号超管 + forceReplace → 降级旧超管 + 立新超管 + 留痕，返回 replaced', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1, account: 'legacy_admin' }]) // supers
      .mockResolvedValueOnce([]) // 目标 account 占用查询=空
    mockConnExecute.mockResolvedValue([{ insertId: 20 }])
    const res = await seedSuperAdmin({ ...CFG, forceReplace: true })
    expect(res).toEqual({ status: 'replaced', userId: 20, demotedIds: [1] })
    // 事务内：UPDATE 降级 + 降级留痕(1) + INSERT user + INSERT checkin + bootstrap 留痕 = 5 次
    expect(mockConnExecute).toHaveBeenCalledTimes(5)
    const [demoteSql, demoteParams] = mockConnExecute.mock.calls[0]!
    expect(demoteSql).toContain('UPDATE `user` SET role')
    expect(demoteParams).toEqual([ROLE_ADMIN, ROLE_SUPER_ADMIN])
  })
})

describe('seedSuperAdmin - DB 未就绪 fail-fast', () => {
  it('读 user 表抛错（未迁移）→ 抛出带迁移提示的错误', async () => {
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error('no such table'), { code: 'ER_NO_SUCH_TABLE' }),
    )
    await expect(seedSuperAdmin(CFG)).rejects.toThrow(/npm run migrate/)
  })
})
