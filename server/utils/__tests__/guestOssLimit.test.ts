import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 计数已接入 rateStore（rl 域固窗，P2）：mock incrWindow 用内存 Map 按 id 模拟
// 「同 key 连续自增 1/2/3...」语义；configStore 仍 mock 固定 Map（配置读取路径不变）
const { mockGetSysConfigKeys, mockIncrWindow, incrCounts } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
  mockIncrWindow: vi.fn(),
  incrCounts: new Map<string, number>(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))
vi.mock('#server/utils/rateStore', () => ({ incrWindow: mockIncrWindow }))

// 每次测试前重置模块注册表与 mock 计数状态，确保用例间干净
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  incrCounts.clear()
  mockIncrWindow.mockImplementation(async (_domain: string, id: string) => {
    const count = (incrCounts.get(id) ?? 0) + 1
    incrCounts.set(id, count)
    return { count, retryAfterSec: 86400 }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function loadModule() {
  return await import('../../utils/guestOssLimit')
}

/** 配置 mock：guest_daily_audio_limit 经 configStore 返回 */
function setupLimitMap(limit: string) {
  mockGetSysConfigKeys.mockResolvedValue(new Map([['guest_daily_audio_limit', limit]]))
}

describe('checkGuestAudioLimit 游客音频限流', () => {
  it('未超限 → allowed=true, remaining > 0', async () => {
    setupLimitMap('5')
    const { checkGuestAudioLimit } = await loadModule()
    const res = await checkGuestAudioLimit('gk-1')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(4) // 5 - 1 = 4
  })

  it('连续调用逐步递减 remaining', async () => {
    setupLimitMap('5')
    const { checkGuestAudioLimit } = await loadModule()
    const r1 = await checkGuestAudioLimit('gk-1')
    expect(r1).toEqual({ allowed: true, remaining: 4 })
    const r2 = await checkGuestAudioLimit('gk-1')
    expect(r2).toEqual({ allowed: true, remaining: 3 })
    const r3 = await checkGuestAudioLimit('gk-1')
    expect(r3).toEqual({ allowed: true, remaining: 2 })
  })

  it('达到上限 → allowed=false, remaining=0', async () => {
    setupLimitMap('5')
    const { checkGuestAudioLimit } = await loadModule()
    for (let i = 0; i < 5; i++) await checkGuestAudioLimit('gk-1')
    const blocked = await checkGuestAudioLimit('gk-1')
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('不同 guestKey 独立计数', async () => {
    setupLimitMap('5')
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
    setupLimitMap('5')
    const { checkGuestAudioLimit } = await loadModule()
    // 第一天用掉全部 5 次
    for (let i = 0; i < 5; i++) await checkGuestAudioLimit('gk-1')
    const blocked = await checkGuestAudioLimit('gk-1')
    expect(blocked.allowed).toBe(false)

    // 模拟跳到第二天（Date.now 影响 todayKey()）
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000
    vi.spyOn(Date, 'now').mockReturnValue(tomorrow)

    // 新的一天计数键变化，固窗重开
    const res = await checkGuestAudioLimit('gk-1')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(4)
  })

  it('经 rateStore rl 域计数：键=guest-audio-key:{guestKey}:{日期}，窗口 24h', async () => {
    setupLimitMap('5')
    const { checkGuestAudioLimit } = await loadModule()
    await checkGuestAudioLimit('gk-1')
    expect(mockIncrWindow).toHaveBeenCalledTimes(1)
    expect(mockIncrWindow).toHaveBeenCalledWith(
      'rl',
      expect.stringMatching(/^guest-audio-key:gk-1:\d{4}-\d{2}-\d{2}$/),
      86400,
    )
  })

  it('模块内无配置缓存：每次调用都委托 configStore（缓存语义由 configStore 承载）', async () => {
    setupLimitMap('5')
    const { checkGuestAudioLimit } = await loadModule()
    await checkGuestAudioLimit('gk-1')
    await checkGuestAudioLimit('gk-2')
    await checkGuestAudioLimit('gk-3')
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(3)
    // 批量读取一次传入单键
    expect(mockGetSysConfigKeys.mock.calls[0]![0]).toEqual(['guest_daily_audio_limit'])
  })

  it('配置变更即时生效：configStore 返回新值后下次调用立即采用（无需 invalidate）', async () => {
    mockGetSysConfigKeys
      .mockResolvedValueOnce(new Map([['guest_daily_audio_limit', '5']]))
      .mockResolvedValueOnce(new Map([['guest_daily_audio_limit', '2']]))
    const { checkGuestAudioLimit } = await loadModule()
    const r1 = await checkGuestAudioLimit('gk-1')
    expect(r1.remaining).toBe(4) // limit 5
    const r2 = await checkGuestAudioLimit('gk-2')
    expect(r2.remaining).toBe(1) // limit 2 已生效
  })

  it('sys_config 读取失败（configStore 异常）→ 使用默认限次 20', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    const { checkGuestAudioLimit } = await loadModule()
    const res = await checkGuestAudioLimit('gk-fail')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(19) // 默认 20 - 1
  })
})
