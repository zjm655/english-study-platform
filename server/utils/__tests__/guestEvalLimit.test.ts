/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQuery, mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetSysConfigKeys: vi.fn(),
}))
vi.mock('#server/utils/db', () => ({ query: mockQuery }))
// sys_config 读取已接入 configStore（limitCache 已删），mock getSysConfigKeys；
// per-guest 结果缓存与 user / eval_auth_log 查询仍走 db.query，保留 db mock
vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

// 每次测试前重置模块注册表，确保 per-guest 结果缓存等模块级状态全新
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

async function loadModule() {
  return await import('../../utils/guestEvalLimit')
}

/** 配置 mock：guest_daily_eval_limit 经 configStore 返回（缺键/异常场景由各用例自行覆盖） */
function setupLimitMap(limit: string) {
  mockGetSysConfigKeys.mockResolvedValue(new Map([['guest_daily_eval_limit', limit]]))
}

/** 配置 db mock 按调用顺序返回 user / eval_auth_log 查询结果 */
function setupEvalQuery(opts: { userId?: number | null; recordingCount?: number }) {
  const { userId = 42, recordingCount = 0 } = opts
  const calls: any[] = []
  if (userId !== null) {
    calls.push([{ id: userId }]) // user 表查 guestKey → userId
    calls.push([{ cnt: recordingCount }]) // eval_auth_log 计数
  } else {
    calls.push([[]]) // user 表无行
  }
  let idx = 0
  mockQuery.mockImplementation(() => Promise.resolve(calls[idx++] ?? []))
}

describe('checkGuestEvalLimit 游客评测限流', () => {
  it('未超限 → allowed=true, remaining > 0', async () => {
    setupLimitMap('3')
    setupEvalQuery({ userId: 42, recordingCount: 1 })
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(2) // 3 - 1
    expect(res.used).toBe(1)
    expect(res.limit).toBe(3)
  })

  it('达到上限 → allowed=false, remaining=0', async () => {
    setupLimitMap('2')
    setupEvalQuery({ userId: 42, recordingCount: 2 })
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
    expect(res.used).toBe(2)
    expect(res.limit).toBe(2)
  })

  it('游客尚未实体化（无 user 行）→ 视为 0 次使用，放行', async () => {
    setupLimitMap('3')
    mockQuery.mockResolvedValueOnce([[]]) // user 表无行
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-new', 'shadow')
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(0)
    expect(res.remaining).toBe(3)
  })

  it('dubbing 和 shadow 独立计数', async () => {
    setupLimitMap('3')
    // dubbing：user + 计数（count = 2）
    mockQuery
      .mockResolvedValueOnce([{ id: 42 }]) // user 表
      .mockResolvedValueOnce([{ cnt: 2 }]) // dubbing 录音数
      .mockResolvedValueOnce([{ id: 42 }]) // user 表（shadow 再次查询）
      .mockResolvedValueOnce([{ cnt: 0 }]) // shadow 录音数
    const { checkGuestEvalLimit } = await loadModule()
    const dubRes = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(dubRes.used).toBe(2)
    expect(dubRes.remaining).toBe(1)

    const shaRes = await checkGuestEvalLimit('gk-1', 'shadow')
    expect(shaRes.used).toBe(0)
    expect(shaRes.remaining).toBe(3)
  })

  it('per-guest 结果缓存命中时不重复查库（limit 读取无模块缓存，每次委托 configStore）', async () => {
    setupLimitMap('5')
    setupEvalQuery({ userId: 42, recordingCount: 1 })
    const { checkGuestEvalLimit } = await loadModule()
    // 首次调用走完整查库流程
    await checkGuestEvalLimit('gk-1', 'dubbing')
    const callsAfterFirst = mockQuery.mock.calls.length
    // 第二次调用命中 per-guest 结果缓存，不再查库
    const res2 = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res2.allowed).toBe(true)
    expect(res2.used).toBe(1)
    expect(mockQuery.mock.calls.length).toBe(callsAfterFirst) // db 无新增调用
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2) // limit 每次经 configStore
  })

  it('查库失败兜底放行 → allowed=true', async () => {
    setupLimitMap('3')
    mockQuery.mockRejectedValueOnce(new Error('db down')) // user 表查询失败
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-err', 'dubbing')
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(0)
    expect(res.remaining).toBe(3)
  })

  it('sys_config 读取失败（configStore 异常）→ 使用默认限次 1', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    mockQuery
      .mockResolvedValueOnce([{ id: 42 }]) // user 表
      .mockResolvedValueOnce([{ cnt: 0 }]) // recording 计数
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-fail', 'shadow')
    expect(res.allowed).toBe(true)
    expect(res.limit).toBe(1) // 默认值
  })
})

describe('getGuestEvalQuota 配额查询', () => {
  it('返回两种 phase 的配额状态', async () => {
    setupLimitMap('5')
    mockQuery
      .mockResolvedValueOnce([{ id: 42 }]) // user 表
      .mockResolvedValueOnce([
        // eval_auth_log GROUP BY phase
        { phase: 3, cnt: 2 }, // dubbing
        { phase: 4, cnt: 1 }, // shadow
      ])
    const { getGuestEvalQuota } = await loadModule()
    const quota = await getGuestEvalQuota('gk-1')
    expect(quota.dubbing).toEqual({ used: 2, limit: 5 })
    expect(quota.shadow).toEqual({ used: 1, limit: 5 })
  })

  it('游客未实体化 → 两种 phase 均为 0', async () => {
    setupLimitMap('3')
    mockQuery.mockResolvedValueOnce([[]]) // 无 user 行
    const { getGuestEvalQuota } = await loadModule()
    const quota = await getGuestEvalQuota('gk-new')
    expect(quota.dubbing).toEqual({ used: 0, limit: 3 })
    expect(quota.shadow).toEqual({ used: 0, limit: 3 })
  })

  it('查库失败兜底返回零值', async () => {
    setupLimitMap('3')
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const { getGuestEvalQuota } = await loadModule()
    const quota = await getGuestEvalQuota('gk-err')
    expect(quota.dubbing).toEqual({ used: 0, limit: 3 })
    expect(quota.shadow).toEqual({ used: 0, limit: 3 })
  })
})
