import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('#server/utils/db', () => ({ query: mockQuery }))

// 每次测试前重置模块注册表，确保 usageMap / cachedLimit 等模块级状态全新
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function loadModule() {
  return await import('../../utils/guestOssLimit')
}

describe('checkGuestAudioLimit 游客音频限流', () => {
  it('未超限 → allowed=true, remaining > 0', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const { checkGuestAudioLimit } = await loadModule()
    const res = await checkGuestAudioLimit('gk-1')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(4) // 5 - 0 - 1 = 4
  })

  it('连续调用逐步递减 remaining', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const { checkGuestAudioLimit } = await loadModule()
    const r1 = await checkGuestAudioLimit('gk-1')
    expect(r1).toEqual({ allowed: true, remaining: 4 })
    const r2 = await checkGuestAudioLimit('gk-1')
    expect(r2).toEqual({ allowed: true, remaining: 3 })
    const r3 = await checkGuestAudioLimit('gk-1')
    expect(r3).toEqual({ allowed: true, remaining: 2 })
  })

  it('达到上限 → allowed=false, remaining=0', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const { checkGuestAudioLimit } = await loadModule()
    for (let i = 0; i < 5; i++) await checkGuestAudioLimit('gk-1')
    const blocked = await checkGuestAudioLimit('gk-1')
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('不同 guestKey 独立计数', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const { checkGuestAudioLimit } = await loadModule()
    // gk-A 用掉 3 次 → remaining = 5-3 = 2
    for (let i = 0; i < 3; i++) await checkGuestAudioLimit('gk-A')
    // gk-B 不受影响
    const resB = await checkGuestAudioLimit('gk-B')
    expect(resB.allowed).toBe(true)
    expect(resB.remaining).toBe(4)
    // gk-A 第 4 次调用 → remaining = 5-4 = 1
    const resA = await checkGuestAudioLimit('gk-A')
    expect(resA.remaining).toBe(1)
  })

  it('不同日期独立计数（跨天重置）', async () => {
    // mockResolvedValue 确保跨天 cachedLimit 过期后重新查库也能返回
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const { checkGuestAudioLimit } = await loadModule()
    // 第一天用掉全部 5 次
    for (let i = 0; i < 5; i++) await checkGuestAudioLimit('gk-1')
    const blocked = await checkGuestAudioLimit('gk-1')
    expect(blocked.allowed).toBe(false)

    // 模拟跳到第二天（Date.now 影响 todayKey() 和 cachedLimit TTL）
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000
    vi.spyOn(Date, 'now').mockReturnValue(tomorrow)

    // 新的一天 usageMap 键变化，计数重置
    const res = await checkGuestAudioLimit('gk-1')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(4)
  })

  it('缓存行为：sys_config 只查一次（5min TTL 内不重复查库）', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const { checkGuestAudioLimit } = await loadModule()
    await checkGuestAudioLimit('gk-1')
    await checkGuestAudioLimit('gk-2')
    await checkGuestAudioLimit('gk-3')
    // sys_config 只在首次 getDailyLimit 时查一次
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('invalidateCache 后再次调用会重新查 sys_config', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const mod = await loadModule()
    await mod.checkGuestAudioLimit('gk-1')
    expect(mockQuery).toHaveBeenCalledTimes(1)

    mod.invalidateGuestAudioLimitCache()
    await mod.checkGuestAudioLimit('gk-2')
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('sys_config 查询失败 → 使用默认限次 20', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const { checkGuestAudioLimit } = await loadModule()
    const res = await checkGuestAudioLimit('gk-fail')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(19) // 默认 20 - 1
  })

  it('getGuestAudioLimitStats 返回跟踪条目数', async () => {
    mockQuery.mockResolvedValue([{ config_value: '5' }])
    const mod = await loadModule()
    expect(mod.getGuestAudioLimitStats().trackedEntries).toBe(0)
    await mod.checkGuestAudioLimit('gk-1')
    expect(mod.getGuestAudioLimitStats().trackedEntries).toBe(1)
    await mod.checkGuestAudioLimit('gk-2')
    expect(mod.getGuestAudioLimitStats().trackedEntries).toBe(2)
  })
})
