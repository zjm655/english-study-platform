import { describe, it, expect, vi, beforeEach } from 'vitest'

// rateLimiter 计数已接入 rateStore（P2 Task 2，rl 域固窗）：mock rateStore 的 incrWindow，
// 用「同 id 连续调用 count 递增（被拒不停止，D-P2-2）、不同 id 独立」的固窗 mock 模拟真实
// 语义（vi.hoisted + vi.mock 先例同 configStore）；水位探针委托 getRateStoreStats，一并 mock
// 以断言映射关系。配置读取仍 mock getSysConfigKeys 返回固定 Map；vi.resetModules + 动态
// import 保证用例间干净态。

const { mockGetSysConfigKeys, mockIncrWindow, mockGetRateStoreStats } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
  mockIncrWindow: vi.fn(),
  mockGetRateStoreStats: vi.fn(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))
vi.mock('#server/utils/rateStore', () => ({
  incrWindow: mockIncrWindow,
  getRateStoreStats: mockGetRateStoreStats,
}))

/** 固窗 mock：同 id 连续调用 count 递增（被拒不停止，对齐 D-P2-2），不同 id 独立计数；retryAfterSec 透传窗口秒数 */
function installFixedWindow() {
  const counts = new Map<string, number>()
  mockIncrWindow.mockImplementation((_domain: string, id: string, windowSec: number) => {
    const count = (counts.get(id) ?? 0) + 1
    counts.set(id, count)
    return { count, retryAfterSec: windowSec }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  installFixedWindow()
})

// 每次拿到干净模块实例
async function loadLimiter() {
  return await import('../rateLimiter')
}

// 默认全开的限流配置（含上传独立配置）
const FULL_CFG = {
  enabled: true,
  ipLevel: true,
  userLevel: true,
  uploadEnabled: true,
  uploadMax: 10,
  uploadWindow: 60,
}

// ============ getRateLimitConfig 开关读取 ============

describe('getRateLimitConfig - 开关读取', () => {
  it('全开 → 返回全 true + 上传默认 10/60', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['rate_limit_enabled', '1'],
        ['rate_limit_ip_level', '1'],
        ['rate_limit_user_level', '1'],
        ['rate_limit_upload_enabled', '1'],
        ['rate_limit_upload_max', '10'],
        ['rate_limit_upload_window', '60'],
      ]),
    )
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({
      enabled: true,
      ipLevel: true,
      userLevel: true,
      uploadEnabled: true,
      uploadMax: 10,
      uploadWindow: 60,
    })
  })

  it('enabled=0 → 全局关，但 uploadEnabled 仍可独立为 true', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['rate_limit_enabled', '0'],
        ['rate_limit_ip_level', '1'],
        ['rate_limit_user_level', '1'],
        ['rate_limit_upload_enabled', '1'],
        ['rate_limit_upload_max', '5'],
        ['rate_limit_upload_window', '120'],
      ]),
    )
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({
      enabled: false,
      ipLevel: true,
      userLevel: true,
      uploadEnabled: true,
      uploadMax: 5,
      uploadWindow: 120,
    })
  })

  it('uploadEnabled=0 → 上传限流关，全局仍开', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(
      new Map([
        ['rate_limit_enabled', '1'],
        ['rate_limit_ip_level', '1'],
        ['rate_limit_user_level', '1'],
        ['rate_limit_upload_enabled', '0'],
        ['rate_limit_upload_max', '10'],
        ['rate_limit_upload_window', '60'],
      ]),
    )
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg.uploadEnabled).toBe(false)
    expect(cfg.enabled).toBe(true)
  })

  it('configStore 缺键（Map 为空）→ 回退默认全开（含上传默认 10/60）', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({
      enabled: true,
      ipLevel: true,
      userLevel: true,
      uploadEnabled: true,
      uploadMax: 10,
      uploadWindow: 60,
    })
  })

  it('configStore 抛错 → 回退默认全开（含上传默认 10/60）', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({
      enabled: true,
      ipLevel: true,
      userLevel: true,
      uploadEnabled: true,
      uploadMax: 10,
      uploadWindow: 60,
    })
  })

  it('模块内无缓存：每次调用都委托 configStore（缓存语义由 configStore 承载）', async () => {
    mockGetSysConfigKeys.mockResolvedValue(
      new Map([
        ['rate_limit_enabled', '1'],
        ['rate_limit_ip_level', '1'],
        ['rate_limit_user_level', '1'],
        ['rate_limit_upload_enabled', '1'],
        ['rate_limit_upload_max', '10'],
        ['rate_limit_upload_window', '60'],
      ]),
    )
    const { getRateLimitConfig } = await loadLimiter()
    await getRateLimitConfig()
    await getRateLimitConfig()
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
    // 批量读取一次传入全部 6 键
    expect(mockGetSysConfigKeys.mock.calls[0]![0]).toEqual([
      'rate_limit_enabled',
      'rate_limit_ip_level',
      'rate_limit_user_level',
      'rate_limit_upload_enabled',
      'rate_limit_upload_max',
      'rate_limit_upload_window',
    ])
  })
})

// ============ checkRateLimit IP 级 ============

describe('checkRateLimit - IP 级限流', () => {
  it('未超限返回 { allowed: true }', async () => {
    const { checkRateLimit } = await loadLimiter()
    const res = await checkRateLimit('1.2.3.4', '/api/units', FULL_CFG)
    expect(res).toEqual({ allowed: true })
  })

  it('计数键格式：rl 域 ip:{ip}:{path}，窗口秒数 = Math.ceil(windowMs/1000)，query 被剥掉', async () => {
    const { checkRateLimit } = await loadLimiter()
    await checkRateLimit('1.2.3.4', '/api/units?x=1&y=2', FULL_CFG)
    expect(mockIncrWindow).toHaveBeenCalledTimes(1)
    expect(mockIncrWindow).toHaveBeenCalledWith('rl', 'ip:1.2.3.4:/api/units', 60)
  })

  it('超限：对 /api/evaluation/auth 调 11 次，第 11 次被拒（同 key count 递增至 11 > 10）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.1'
    for (let i = 0; i < 10; i++) {
      expect(await checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)).toEqual({ allowed: true })
    }
    const res = await checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)
    expect(res.allowed).toBe(false)
    expect(res.retryAfter).toBeGreaterThan(0)
    // 被拒请求也计数（D-P2-2）：第 11 次自增发生在拒绝判定前
    expect(mockIncrWindow).toHaveBeenCalledTimes(11)
    expect(mockIncrWindow).toHaveBeenLastCalledWith('rl', `ip:${ip}:/api/evaluation/auth`, 60)
  })

  it('被拒后计数继续增长（D-P2-2）：再调一次 count 更大仍被拒', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.8'
    for (let i = 0; i < 11; i++) {
      await checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)
    }
    const res = await checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)
    expect(res.allowed).toBe(false)
    // 第 12 次调用 count=12（被拒仍计数、持续增长），窗口剩余秒数透传为 retryAfter
    expect(mockIncrWindow).toHaveBeenCalledTimes(12)
    expect(mockIncrWindow.mock.results[11]!.value).toEqual({ count: 12, retryAfterSec: 60 })
  })

  it('retryAfter 透传 incrWindow 返回的窗口剩余秒数（retryAfterSec）', async () => {
    mockIncrWindow.mockImplementationOnce(() => ({ count: 61, retryAfterSec: 42 }))
    const { checkRateLimit } = await loadLimiter()
    const res = await checkRateLimit('10.0.0.2', '/api/units', FULL_CFG)
    expect(res).toEqual({ allowed: false, retryAfter: 42 })
  })

  it('cross-path 不污染：先打 10 个 /api/units，再打 /api/segment/upload 应通过', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.3'
    // /api/units 走默认 60/min，打 10 次远未到上限
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(ip, '/api/units', FULL_CFG)
    }
    // /api/segment/upload 独立 counter（key 含 path），应通过
    const res = await checkRateLimit(ip, '/api/segment/upload', FULL_CFG)
    expect(res).toEqual({ allowed: true })
  })

  it('上传限流开关关闭时直接放行且不计数（独立于全局 enabled）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, uploadEnabled: false }
    const ip = '10.0.0.4'
    // 即便调很多次，开关关 → 全部放行
    for (let i = 0; i < 20; i++) {
      expect(await checkRateLimit(ip, '/api/segment/upload', cfg)).toEqual({ allowed: true })
    }
    expect(mockIncrWindow).not.toHaveBeenCalled()
  })

  it('上传路径独立计数：/api/segment/upload 调满 10 次后第 11 次被拒', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.5'
    for (let i = 0; i < 10; i++) {
      expect(await checkRateLimit(ip, '/api/segment/upload', FULL_CFG)).toEqual({ allowed: true })
    }
    const res = await checkRateLimit(ip, '/api/segment/upload', FULL_CFG)
    expect(res.allowed).toBe(false)
  })

  it('全局 enabled=0 时非上传路径放行（不计数），上传路径仍受限（uploadEnabled=true）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, enabled: false }
    const ip = '10.0.0.6'
    // 非上传路径：全局关 → 放行且不计数
    expect(await checkRateLimit(ip, '/api/units', cfg)).toEqual({ allowed: true })
    expect(mockIncrWindow).not.toHaveBeenCalled()
    // 上传路径：uploadEnabled=true → 仍受限，调 10 次后第 11 次被拒
    for (let i = 0; i < 10; i++) {
      expect(await checkRateLimit(ip, '/api/segment/upload', cfg)).toEqual({ allowed: true })
    }
    const res = await checkRateLimit(ip, '/api/segment/upload', cfg)
    expect(res.allowed).toBe(false)
  })

  it('登录严格档：/api/user/login 调 10 次后第 11 次被拒（独立于全局 enabled/ipLevel）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, enabled: false, ipLevel: false }
    const ip = '10.0.0.7'
    for (let i = 0; i < 10; i++) {
      expect(await checkRateLimit(ip, '/api/user/login', cfg)).toEqual({ allowed: true })
    }
    const res = await checkRateLimit(ip, '/api/user/login', cfg)
    expect(res.allowed).toBe(false)
    // 登录严格档键同样走 rl 域 ip:{ip}:{path}
    expect(mockIncrWindow).toHaveBeenLastCalledWith('rl', `ip:${ip}:/api/user/login`, 60)
  })
})

// ============ checkUserRateLimit 用户级独立计数 ============

describe('checkUserRateLimit - 用户级独立计数', () => {
  it('计数键格式：rl 域 user:{userId}@{ip}:{path}，query 被剥掉', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    await checkUserRateLimit('1.2.3.4', '/api/units?x=1', 7, FULL_CFG)
    expect(mockIncrWindow).toHaveBeenCalledTimes(1)
    expect(mockIncrWindow).toHaveBeenCalledWith('rl', 'user:7@1.2.3.4:/api/units', 60)
  })

  it('同 IP 不同 userId 互不影响：user1 调满 10 次后第 11 次被拒，user2 第 1 次仍 allowed', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const ip = '192.168.1.1'
    for (let i = 0; i < 10; i++) {
      expect(await checkUserRateLimit(ip, '/api/evaluation/auth', 1, FULL_CFG)).toEqual({
        allowed: true,
      })
    }
    const res1 = await checkUserRateLimit(ip, '/api/evaluation/auth', 1, FULL_CFG)
    expect(res1.allowed).toBe(false)
    const res2 = await checkUserRateLimit(ip, '/api/evaluation/auth', 2, FULL_CFG)
    expect(res2).toEqual({ allowed: true })
  })

  it('同 userId 不同 IP 也独立（key 为 user:{userId}@{ip}:{path}）', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    for (let i = 0; i < 10; i++) {
      await checkUserRateLimit('1.1.1.1', '/api/evaluation/auth', 1, FULL_CFG)
    }
    expect((await checkUserRateLimit('1.1.1.1', '/api/evaluation/auth', 1, FULL_CFG)).allowed).toBe(
      false,
    )
    expect(await checkUserRateLimit('2.2.2.2', '/api/evaluation/auth', 1, FULL_CFG)).toEqual({
      allowed: true,
    })
  })

  it('cross-path 不污染：user1 调满 10 次 /api/units 后，user1 打 /api/segment/upload 仍通过', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const ip = '192.168.1.2'
    // /api/units 默认 60/min，打 10 次未到上限
    for (let i = 0; i < 10; i++) {
      await checkUserRateLimit(ip, '/api/units', 1, FULL_CFG)
    }
    // 上传路径独立 counter（key 含 path），应通过
    expect(await checkUserRateLimit(ip, '/api/segment/upload', 1, FULL_CFG)).toEqual({
      allowed: true,
    })
  })

  it('上传限流开关关闭时直接放行且不计数', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, uploadEnabled: false }
    const ip = '192.168.1.3'
    for (let i = 0; i < 20; i++) {
      expect(await checkUserRateLimit(ip, '/api/segment/upload', 1, cfg)).toEqual({
        allowed: true,
      })
    }
    expect(mockIncrWindow).not.toHaveBeenCalled()
  })
})

// ============ getRateLimiterStats 只读探针 ============

describe('getRateLimiterStats - 计数水位探针（委托 rateStore）', () => {
  it('trackedKeys/maxEntries 映射 getRateStoreStats 的 memoryEntries/memoryMaxEntries', async () => {
    mockGetRateStoreStats.mockReturnValue({ memoryEntries: 3, memoryMaxEntries: 50_000 })
    const { getRateLimiterStats } = await loadLimiter()
    expect(getRateLimiterStats()).toEqual({ trackedKeys: 3, maxEntries: 50_000 })
    expect(mockGetRateStoreStats).toHaveBeenCalledTimes(1)
  })
})
