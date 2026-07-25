import { describe, it, expect, vi, beforeEach } from 'vitest'

import { checkDailyQuota, invalidateQuotaCache } from '../quotaChecker'

// 模块内部用 query 查 sys_config + recording 计数，mock 掉 db.query 即可隔离逻辑
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))

const ROLE_ADMIN = 1
const ROLE_USER = 0

/** 默认 sys_config 返回（limit=20, window=86400） */
const DEFAULT_CONFIG_ROWS = [
  { config_key: 'daily_eval_limit', config_value: '20' },
  { config_key: 'eval_limit_window', config_value: '86400' },
]

beforeEach(() => {
  vi.clearAllMocks()
  // 模块内部 cachedConfig 是模块级状态，需在每条用例前清掉避免互相污染
  invalidateQuotaCache()
})

// ============ 管理员不受限 ============

describe('quotaChecker - 管理员不受限', () => {
  it('role=1 直接返回 allowed=true 且不查 db', async () => {
    const res = await checkDailyQuota(1, ROLE_ADMIN)
    expect(res).toEqual({ allowed: true, used: 0, limit: Infinity, windowSec: 0 })
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ============ 普通用户额度判定 ============

describe('quotaChecker - 普通用户额度判定', () => {
  it('未超限（used=5 < limit=20）→ allowed', async () => {
    mockQuery
      .mockResolvedValueOnce(DEFAULT_CONFIG_ROWS) // sys_config
      .mockResolvedValueOnce([{ cnt: 5 }]) // recording 计数
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res).toEqual({ allowed: true, used: 5, limit: 20, windowSec: 86400 })
  })

  it('刚好达到上限（used=20）→ allowed=false', async () => {
    mockQuery.mockResolvedValueOnce(DEFAULT_CONFIG_ROWS).mockResolvedValueOnce([{ cnt: 20 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.allowed).toBe(false)
    expect(res.used).toBe(20)
    expect(res.limit).toBe(20)
  })

  it('超限（used=25）→ allowed=false', async () => {
    mockQuery.mockResolvedValueOnce(DEFAULT_CONFIG_ROWS).mockResolvedValueOnce([{ cnt: 25 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.allowed).toBe(false)
    expect(res.used).toBe(25)
  })
})

// ============ SQL 包含窗口查询（按 eval_auth_log 计数） ============

describe('quotaChecker - SQL 含 DATE_SUB 窗口 + 按 eval_auth_log 计数', () => {
  it('计数 SQL 含 DATE_SUB / user_id / eval_auth_log', async () => {
    mockQuery.mockResolvedValueOnce(DEFAULT_CONFIG_ROWS).mockResolvedValueOnce([{ cnt: 5 }])
    await checkDailyQuota(2, ROLE_USER)
    // 第二次 query 调用才是额度计数
    const countSql = mockQuery.mock.calls[1]![0] as string
    expect(countSql).toContain('eval_auth_log')
    expect(countSql).toContain('user_id = ?')
    expect(countSql).toContain('DATE_SUB')
  })

  it('自定义窗口（3600秒）时 SQL 参数正确传入', async () => {
    const customConfig = [
      { config_key: 'daily_eval_limit', config_value: '10' },
      { config_key: 'eval_limit_window', config_value: '3600' },
    ]
    mockQuery.mockResolvedValueOnce(customConfig).mockResolvedValueOnce([{ cnt: 3 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    // 验证计数查询参数包含 windowSec=3600
    const countParams = mockQuery.mock.calls[1]![1] as number[]
    expect(countParams).toEqual([2, 3600])
    expect(res.windowSec).toBe(3600)
    expect(res.limit).toBe(10)
  })
})

// ============ sys_config 查询失败回退默认值 ============

describe('quotaChecker - sys_config 查询失败回退默认值', () => {
  it('sys_config 查询抛错 → limit=20 windowSec=86400，recording 计数正常', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('db error')) // sys_config 失败
      .mockResolvedValueOnce([{ cnt: 3 }]) // recording 计数正常
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.limit).toBe(20)
    expect(res.windowSec).toBe(86400)
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(3)
  })
})

// ============ 缓存 ============

describe('quotaChecker - 缓存', () => {
  it('连续两次 checkDailyQuota → sys_config 只查 1 次（第二次走缓存）', async () => {
    mockQuery
      .mockResolvedValueOnce(DEFAULT_CONFIG_ROWS) // 1st: sys_config
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
      .mockResolvedValueOnce(DEFAULT_CONFIG_ROWS) // 1st: sys_config
      .mockResolvedValueOnce([{ cnt: 1 }]) // 1st: recording
      .mockResolvedValueOnce(DEFAULT_CONFIG_ROWS) // 2nd: sys_config（缓存已失效）
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
