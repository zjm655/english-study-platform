import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  checkDailyQuota,
  checkEvalGate,
  getEvalGateSnapshot,
  invalidateQuotaCache,
} from '../quotaChecker'

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

// ============ 评测并发闸门（拒绝型） ============

describe('quotaChecker - 评测并发闸门', () => {
  const GATE_CONFIG_ROWS = [
    { config_key: 'eval_gate_max', config_value: '3' },
    { config_key: 'eval_gate_window', config_value: '300' },
  ]

  it('活跃数未达阈值 → allowed', async () => {
    mockQuery
      .mockResolvedValueOnce(GATE_CONFIG_ROWS) // sys_config
      .mockResolvedValueOnce([{ cnt: 2 }]) // 近窗发放计数
    const res = await checkEvalGate()
    expect(res).toEqual({ allowed: true, active: 2, limit: 3 })
  })

  it('活跃数达到阈值 → 拒绝', async () => {
    mockQuery.mockResolvedValueOnce(GATE_CONFIG_ROWS).mockResolvedValueOnce([{ cnt: 3 }])
    const res = await checkEvalGate()
    expect(res.allowed).toBe(false)
    expect(res.active).toBe(3)
  })

  it('max=0 表示不限制：直接放行且不查计数', async () => {
    mockQuery.mockResolvedValueOnce([
      { config_key: 'eval_gate_max', config_value: '0' },
      { config_key: 'eval_gate_window', config_value: '300' },
    ])
    const res = await checkEvalGate()
    expect(res.allowed).toBe(true)
    // 仅查了配置，未查 eval_auth_log 计数
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('配置查询失败时用默认值（max=20）不阻塞业务', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('db down')) // sys_config 失败
      .mockResolvedValueOnce([{ cnt: 5 }])
    const res = await checkEvalGate()
    expect(res).toEqual({ allowed: true, active: 5, limit: 20 })
  })

  it('闸门配置与额度配置共用 invalidateQuotaCache 失效', async () => {
    mockQuery.mockResolvedValueOnce(GATE_CONFIG_ROWS).mockResolvedValueOnce([{ cnt: 1 }])
    await checkEvalGate()
    invalidateQuotaCache()
    mockQuery
      .mockResolvedValueOnce([
        { config_key: 'eval_gate_max', config_value: '10' },
        { config_key: 'eval_gate_window', config_value: '300' },
      ])
      .mockResolvedValueOnce([{ cnt: 1 }])
    const res = await checkEvalGate()
    expect(res.limit).toBe(10) // 失效后读到新值
  })
})

// ============ 评测闸门监控快照（getEvalGateSnapshot） ============

describe('quotaChecker - 闸门监控快照', () => {
  const GATE_CONFIG_ROWS = [
    { config_key: 'eval_gate_max', config_value: '3' },
    { config_key: 'eval_gate_window', config_value: '300' },
  ]

  it('正常计数：返回 active/limit/windowSec 三元组', async () => {
    mockQuery
      .mockResolvedValueOnce(GATE_CONFIG_ROWS) // sys_config
      .mockResolvedValueOnce([{ cnt: '2' }]) // COUNT 返回字符串也归一
    const res = await getEvalGateSnapshot()
    expect(res).toEqual({ active: 2, limit: 3, windowSec: 300 })
  })

  it('max=0 时仍执行 COUNT 返回真实活跃数（与 checkEvalGate 短路的差异点）', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { config_key: 'eval_gate_max', config_value: '0' },
        { config_key: 'eval_gate_window', config_value: '300' },
      ])
      .mockResolvedValueOnce([{ cnt: 7 }])
    const res = await getEvalGateSnapshot()
    expect(res).toEqual({ active: 7, limit: 0, windowSec: 300 })
    // 配置 + 计数各查一次（监控不走短路）
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('复用 getGateConfig 缓存：连续两次快照 sys_config 只查一次', async () => {
    mockQuery
      .mockResolvedValueOnce(GATE_CONFIG_ROWS) // 1st: sys_config
      .mockResolvedValueOnce([{ cnt: 1 }]) // 1st: count
      .mockResolvedValueOnce([{ cnt: 2 }]) // 2nd: count（配置命中缓存）
    await getEvalGateSnapshot()
    const res = await getEvalGateSnapshot()
    expect(res.active).toBe(2)
    const sysConfigCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('sys_config'),
    )
    expect(sysConfigCalls.length).toBe(1)
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
