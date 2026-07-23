import { describe, it, expect, vi, beforeEach } from 'vitest'

import { checkDailyQuota, invalidateQuotaCache } from '../quotaChecker'

// 模块内部用 query 查 sys_config + recording 计数，mock 掉 db.query 即可隔离逻辑
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))

const ROLE_ADMIN = 1
const ROLE_USER = 0

beforeEach(() => {
  vi.clearAllMocks()
  // 模块内部 cachedLimit 是模块级状态，需在每条用例前清掉避免互相污染
  invalidateQuotaCache()
})

// ============ 管理员不受限 ============

describe('quotaChecker - 管理员不受限', () => {
  it('role=1 直接返回 allowed=true 且不查 db', async () => {
    const res = await checkDailyQuota(1, ROLE_ADMIN)
    expect(res).toEqual({ allowed: true, used: 0, limit: Infinity })
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ============ 普通用户额度判定 ============

describe('quotaChecker - 普通用户额度判定', () => {
  it('未超限（used=5 < limit=20）→ allowed', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '20' }]) // sys_config
      .mockResolvedValueOnce([{ cnt: 5 }]) // recording 计数
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res).toEqual({ allowed: true, used: 5, limit: 20 })
  })

  it('刚好达到上限（used=20）→ allowed=false', async () => {
    mockQuery.mockResolvedValueOnce([{ config_value: '20' }]).mockResolvedValueOnce([{ cnt: 20 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.allowed).toBe(false)
    expect(res.used).toBe(20)
    expect(res.limit).toBe(20)
  })

  it('超限（used=25）→ allowed=false', async () => {
    mockQuery.mockResolvedValueOnce([{ config_value: '20' }]).mockResolvedValueOnce([{ cnt: 25 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.allowed).toBe(false)
    expect(res.used).toBe(25)
  })
})

// ============ SQL 包含成功分析过滤 ============

describe('quotaChecker - SQL 含 analyze_status=success 过滤', () => {
  it('recording 计数 SQL 含 analyze_status / user_id / CURDATE', async () => {
    mockQuery.mockResolvedValueOnce([{ config_value: '20' }]).mockResolvedValueOnce([{ cnt: 5 }])
    await checkDailyQuota(2, ROLE_USER)
    // 第二次 query 调用才是 recording 计数
    const recordingSql = mockQuery.mock.calls[1]![0] as string
    expect(recordingSql).toContain("analyze_status = 'success'")
    expect(recordingSql).toContain('user_id = ?')
    expect(recordingSql).toContain('CURDATE()')
  })
})

// ============ sys_config 查询失败回退默认 20 ============

describe('quotaChecker - sys_config 查询失败回退默认 20', () => {
  it('sys_config 查询抛错 → limit 回退 20，recording 计数正常', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('db error')) // sys_config 失败
      .mockResolvedValueOnce([{ cnt: 3 }]) // recording 计数正常
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.limit).toBe(20)
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(3)
  })
})

// ============ 缓存 ============

describe('quotaChecker - 缓存', () => {
  it('连续两次 checkDailyQuota → sys_config 只查 1 次（第二次走缓存）', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '20' }]) // 1st: sys_config
      .mockResolvedValueOnce([{ cnt: 1 }]) // 1st: recording
      .mockResolvedValueOnce([{ cnt: 2 }]) // 2nd: recording（sys_config 命中缓存）

    await checkDailyQuota(2, ROLE_USER)
    await checkDailyQuota(2, ROLE_USER)

    const sysConfigCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('sys_config'),
    )
    expect(sysConfigCalls.length).toBe(1)
    // 两次 checkDailyQuota 共 3 次 query（1 次 sys_config + 2 次 recording）
    expect(mockQuery.mock.calls.length).toBe(3)
  })

  it('invalidateQuotaCache 后再查会重新查 sys_config', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '20' }]) // 1st: sys_config
      .mockResolvedValueOnce([{ cnt: 1 }]) // 1st: recording
      .mockResolvedValueOnce([{ config_value: '20' }]) // 2nd: sys_config（缓存已失效）
      .mockResolvedValueOnce([{ cnt: 2 }]) // 2nd: recording

    await checkDailyQuota(2, ROLE_USER)
    invalidateQuotaCache()
    await checkDailyQuota(2, ROLE_USER)

    const sysConfigCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('sys_config'),
    )
    expect(sysConfigCalls.length).toBe(2)
    expect(mockQuery.mock.calls.length).toBe(4)
  })
})
