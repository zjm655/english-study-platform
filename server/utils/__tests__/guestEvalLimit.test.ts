/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('#server/utils/db', () => ({ query: mockQuery }))

// 每次测试前重置模块注册表，确保 cache / limitCache 等模块级状态全新
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

async function loadModule() {
  return await import('../../utils/guestEvalLimit')
}

/** 配置 mockQuery 按调用顺序返回不同结果 */
function setupEvalQuery(opts: {
  limit?: string
  userId?: number | null
  recordingCount?: number
}) {
  const { limit = '3', userId = 42, recordingCount = 0 } = opts
  const calls: any[] = [
    [{ config_value: limit }],          // sys_config 查询
  ]
  if (userId !== null) {
    calls.push([{ id: userId }])         // user 表查 guestKey → userId
    calls.push([{ cnt: recordingCount }]) // recording 计数
  } else {
    calls.push([[]])                     // user 表无行
  }
  let idx = 0
  mockQuery.mockImplementation(() => Promise.resolve(calls[idx++] ?? []))
}

describe('checkGuestEvalLimit 游客评测限流', () => {
  it('未超限 → allowed=true, remaining > 0', async () => {
    setupEvalQuery({ limit: '3', userId: 42, recordingCount: 1 })
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(2) // 3 - 1
    expect(res.used).toBe(1)
    expect(res.limit).toBe(3)
  })

  it('达到上限 → allowed=false, remaining=0', async () => {
    setupEvalQuery({ limit: '2', userId: 42, recordingCount: 2 })
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res.allowed).toBe(false)
    expect(res.remaining).toBe(0)
    expect(res.used).toBe(2)
    expect(res.limit).toBe(2)
  })

  it('游客尚未实体化（无 user 行）→ 视为 0 次使用，放行', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '3' }]) // sys_config
      .mockResolvedValueOnce([[]])                      // user 表无行
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-new', 'shadow')
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(0)
    expect(res.remaining).toBe(3)
  })

  it('dubbing 和 shadow 独立计数', async () => {
    // 第一次查 dubbing：recording count = 2
    mockQuery
      .mockResolvedValueOnce([{ config_value: '3' }])  // sys_config（首次）
      .mockResolvedValueOnce([{ id: 42 }])              // user 表
      .mockResolvedValueOnce([{ cnt: 2 }])              // dubbing 录音数
    const { checkGuestEvalLimit } = await loadModule()
    const dubRes = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(dubRes.used).toBe(2)
    expect(dubRes.remaining).toBe(1)

    // 第二次查 shadow：recording count = 0
    // sys_config 命中缓存，只需 user + recording
    mockQuery
      .mockResolvedValueOnce([{ id: 42 }])              // user 表
      .mockResolvedValueOnce([{ cnt: 0 }])              // shadow 录音数
    const shaRes = await checkGuestEvalLimit('gk-1', 'shadow')
    expect(shaRes.used).toBe(0)
    expect(shaRes.remaining).toBe(3)
  })

  it('内存缓存命中时不重复查库', async () => {
    setupEvalQuery({ limit: '5', userId: 42, recordingCount: 1 })
    const { checkGuestEvalLimit } = await loadModule()
    // 首次调用走完整查库流程
    await checkGuestEvalLimit('gk-1', 'dubbing')
    const callsAfterFirst = mockQuery.mock.calls.length
    // 第二次调用命中内存缓存，不再查库
    const res2 = await checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res2.allowed).toBe(true)
    expect(res2.used).toBe(1)
    expect(mockQuery.mock.calls.length).toBe(callsAfterFirst) // 无新增调用
  })

  it('invalidateCache 后清除缓存，下次调用重新查库', async () => {
    setupEvalQuery({ limit: '5', userId: 42, recordingCount: 1 })
    const mod = await loadModule()
    await mod.checkGuestEvalLimit('gk-1', 'dubbing')
    mod.invalidateGuestEvalLimitCache()

    // 重新设置 mock（缓存清除后 limitCache 也清了，需重新提供 sys_config）
    setupEvalQuery({ limit: '5', userId: 42, recordingCount: 2 })
    const res = await mod.checkGuestEvalLimit('gk-1', 'dubbing')
    expect(res.used).toBe(2) // 新查询得到 count=2
  })

  it('查库失败兜底放行 → allowed=true', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '3' }]) // sys_config 成功
      .mockRejectedValueOnce(new Error('db down'))       // user 表查询失败
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-err', 'dubbing')
    expect(res.allowed).toBe(true)
    expect(res.used).toBe(0)
    expect(res.remaining).toBe(3)
  })

  it('sys_config 查询失败 → 使用默认限次 1', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('db down'))       // sys_config 失败
      .mockResolvedValueOnce([{ id: 42 }])               // user 表
      .mockResolvedValueOnce([{ cnt: 0 }])               // recording 计数
    const { checkGuestEvalLimit } = await loadModule()
    const res = await checkGuestEvalLimit('gk-fail', 'shadow')
    expect(res.allowed).toBe(true)
    expect(res.limit).toBe(1) // 默认值
  })
})

describe('getGuestEvalQuota 配额查询', () => {
  it('返回两种 phase 的配额状态', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '5' }])    // sys_config
      .mockResolvedValueOnce([{ id: 42 }])                // user 表
      .mockResolvedValueOnce([                            // recording GROUP BY phase
        { phase: 3, cnt: 2 },  // dubbing
        { phase: 4, cnt: 1 },  // shadow
      ])
    const { getGuestEvalQuota } = await loadModule()
    const quota = await getGuestEvalQuota('gk-1')
    expect(quota.dubbing).toEqual({ used: 2, limit: 5 })
    expect(quota.shadow).toEqual({ used: 1, limit: 5 })
  })

  it('游客未实体化 → 两种 phase 均为 0', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '3' }])
      .mockResolvedValueOnce([[]]) // 无 user 行
    const { getGuestEvalQuota } = await loadModule()
    const quota = await getGuestEvalQuota('gk-new')
    expect(quota.dubbing).toEqual({ used: 0, limit: 3 })
    expect(quota.shadow).toEqual({ used: 0, limit: 3 })
  })

  it('查库失败兜底返回零值', async () => {
    mockQuery
      .mockResolvedValueOnce([{ config_value: '3' }])
      .mockRejectedValueOnce(new Error('db down'))
    const { getGuestEvalQuota } = await loadModule()
    const quota = await getGuestEvalQuota('gk-err')
    expect(quota.dubbing).toEqual({ used: 0, limit: 3 })
    expect(quota.shadow).toEqual({ used: 0, limit: 3 })
  })
})
