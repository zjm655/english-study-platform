import { describe, it, expect, vi, beforeEach } from 'vitest'

import { checkDailyQuota, checkEvalGate, getEvalGateSnapshot } from '../quotaChecker'

// 配置读取已接入 configStore（模块内不再自建缓存）：mock getSysConfigKeys 返回固定 Map；
// 模块内 query 仅承担 eval_auth_log 计数查询，mock db.query 隔离计数逻辑。
const { mockQuery, mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetSysConfigKeys: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

const ROLE_ADMIN = 1
const ROLE_USER = 0

/** 默认评测额度配置（limit=20, window=86400） */
const DEFAULT_CONFIG_MAP = new Map([
  ['daily_eval_limit', '20'],
  ['eval_limit_window', '86400'],
])

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ 管理员不受限 ============

describe('quotaChecker - 管理员不受限', () => {
  it('role=1 直接返回 allowed=true 且不读配置、不查 db', async () => {
    const res = await checkDailyQuota(1, ROLE_ADMIN)
    expect(res).toEqual({ allowed: true, used: 0, limit: Infinity, windowSec: 0 })
    expect(mockGetSysConfigKeys).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

// ============ 评测并发闸门（拒绝型） ============

describe('quotaChecker - 评测并发闸门', () => {
  const GATE_CONFIG_MAP = new Map([
    ['eval_gate_max', '3'],
    ['eval_gate_window', '300'],
  ])

  it('活跃数未达阈值 → allowed', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(GATE_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 2 }]) // 近窗发放计数
    const res = await checkEvalGate()
    expect(res).toEqual({ allowed: true, active: 2, limit: 3 })
  })

  it('活跃数达到阈值 → 拒绝', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(GATE_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 3 }])
    const res = await checkEvalGate()
    expect(res.allowed).toBe(false)
    expect(res.active).toBe(3)
  })

  it('max=0 表示不限制：直接放行且不查计数', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['eval_gate_max', '0'],
        ['eval_gate_window', '300'],
      ]),
    )
    const res = await checkEvalGate()
    expect(res.allowed).toBe(true)
    // 配置走 configStore，query 仅承担 eval_auth_log 计数：未查计数 = query 未被调用
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('配置读取失败时用默认值（max=20）不阻塞业务', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    mockQuery.mockResolvedValueOnce([{ cnt: 5 }])
    const res = await checkEvalGate()
    expect(res).toEqual({ allowed: true, active: 5, limit: 20 })
  })

  it('模块内无缓存：每次 checkEvalGate 都经 configStore 读新值（缓存语义由 configStore 承载）', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(GATE_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 1 }])
    await checkEvalGate()
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['eval_gate_max', '10'],
        ['eval_gate_window', '300'],
      ]),
    )
    mockQuery.mockResolvedValueOnce([{ cnt: 1 }])
    const res = await checkEvalGate()
    expect(res.limit).toBe(10) // 第二次调用即读到新值
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
  })
})

// ============ 评测闸门监控快照（getEvalGateSnapshot） ============

describe('quotaChecker - 闸门监控快照', () => {
  const GATE_CONFIG_MAP = new Map([
    ['eval_gate_max', '3'],
    ['eval_gate_window', '300'],
  ])

  it('正常计数：返回 active/limit/windowSec 三元组', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(GATE_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: '2' }]) // COUNT 返回字符串也归一
    const res = await getEvalGateSnapshot()
    expect(res).toEqual({ active: 2, limit: 3, windowSec: 300 })
  })

  it('max=0 时仍执行 COUNT 返回真实活跃数（与 checkEvalGate 短路的差异点）', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['eval_gate_max', '0'],
        ['eval_gate_window', '300'],
      ]),
    )
    mockQuery.mockResolvedValueOnce([{ cnt: 7 }])
    const res = await getEvalGateSnapshot()
    expect(res).toEqual({ active: 7, limit: 0, windowSec: 300 })
    // 监控不走短路：计数查询照常执行
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('每次快照都经 configStore 读配置，计数走 query（各一次）', async () => {
    mockGetSysConfigKeys.mockResolvedValue(GATE_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 1 }]).mockResolvedValueOnce([{ cnt: 2 }])
    await getEvalGateSnapshot()
    const res = await getEvalGateSnapshot()
    expect(res.active).toBe(2)
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})

// ============ 普通用户额度判定 ============

describe('quotaChecker - 普通用户额度判定', () => {
  it('未超限（used=5 < limit=20）→ allowed', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(DEFAULT_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 5 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res).toEqual({ allowed: true, used: 5, limit: 20, windowSec: 86400 })
  })

  it('刚好达到上限（used=20）→ allowed=false', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(DEFAULT_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 20 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.allowed).toBe(false)
    expect(res.used).toBe(20)
    expect(res.limit).toBe(20)
  })

  it('超限（used=25）→ allowed=false', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(DEFAULT_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 25 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.allowed).toBe(false)
    expect(res.used).toBe(25)
  })
})

// ============ SQL 包含窗口查询（按 eval_auth_log 计数） ============

describe('quotaChecker - SQL 含 DATE_SUB 窗口 + 按 eval_auth_log 计数', () => {
  it('计数 SQL 含 DATE_SUB / user_id / eval_auth_log', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(DEFAULT_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 5 }])
    await checkDailyQuota(2, ROLE_USER)
    // 配置走 configStore 后，query 首次调用即额度计数
    const countSql = mockQuery.mock.calls[0]![0] as string
    expect(countSql).toContain('eval_auth_log')
    expect(countSql).toContain('user_id = ?')
    expect(countSql).toContain('DATE_SUB')
  })

  it('自定义窗口（3600秒）时 SQL 参数正确传入', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['daily_eval_limit', '10'],
        ['eval_limit_window', '3600'],
      ]),
    )
    mockQuery.mockResolvedValueOnce([{ cnt: 3 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    // 验证计数查询参数包含 windowSec=3600
    const countParams = mockQuery.mock.calls[0]![1] as number[]
    expect(countParams).toEqual([2, 3600])
    expect(res.windowSec).toBe(3600)
    expect(res.limit).toBe(10)
  })
})

// ============ sys_config 读取失败/缺键回退默认值 ============

describe('quotaChecker - sys_config 读取失败/缺键回退默认值', () => {
  it('configStore 抛错 → limit=20 windowSec=86400，计数正常', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    mockQuery.mockResolvedValueOnce([{ cnt: 3 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.limit).toBe(20)
    expect(res.windowSec).toBe(86400)
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(3)
  })

  it('configStore 缺键（空 Map）→ 走默认值 20/86400', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    mockQuery.mockResolvedValueOnce([{ cnt: 3 }])
    const res = await checkDailyQuota(2, ROLE_USER)
    expect(res.limit).toBe(20)
    expect(res.windowSec).toBe(86400)
  })
})

// ============ 配置读取路径（configStore 承载缓存） ============

describe('quotaChecker - 配置读取路径', () => {
  it('连续两次 checkDailyQuota → 每次都经 configStore 读配置（各 1 次）+ 计数（各 1 次）', async () => {
    mockGetSysConfigKeys.mockResolvedValue(DEFAULT_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 1 }]).mockResolvedValueOnce([{ cnt: 2 }])

    await checkDailyQuota(2, ROLE_USER)
    await checkDailyQuota(2, ROLE_USER)

    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('配置变化即时生效：第二次读到新 limit（无模块缓存延迟）', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(DEFAULT_CONFIG_MAP)
    mockQuery.mockResolvedValueOnce([{ cnt: 1 }])
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['daily_eval_limit', '5'],
        ['eval_limit_window', '86400'],
      ]),
    )
    mockQuery.mockResolvedValueOnce([{ cnt: 1 }])

    const first = await checkDailyQuota(2, ROLE_USER)
    const second = await checkDailyQuota(2, ROLE_USER)
    expect(first.limit).toBe(20)
    expect(second.limit).toBe(5)
  })
})
