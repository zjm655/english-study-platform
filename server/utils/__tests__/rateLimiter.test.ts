import { describe, it, expect, vi, beforeEach } from 'vitest'

// rateLimiter 有模块级 windowMap（滑动窗口状态），测试之间会互相污染。
// 每个用例前 vi.resetModules() 并动态重新 import，保证干净状态。
// 配置读取已接入 configStore（模块内不再自建缓存），mock getSysConfigKeys 返回固定 Map。

const { mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// 每次拿到带干净 windowMap 的模块实例
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
    const res = checkRateLimit('1.2.3.4', '/api/units', FULL_CFG)
    expect(res).toEqual({ allowed: true })
  })

  it('超限：对 /api/evaluation/auth 调 11 次，第 11 次被拒', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.1'
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)).toEqual({ allowed: true })
    }
    const res = checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)
    expect(res.allowed).toBe(false)
    expect(res.retryAfter).toBeGreaterThan(0)
  })

  it('retryAfter 约等于 60（窗口 60s）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.2'
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)
    }
    const res = checkRateLimit(ip, '/api/evaluation/auth', FULL_CFG)
    // 窗口 60s，连续调用耗时极短，retryAfter 应在 [59, 60]
    expect(res.retryAfter).toBeGreaterThanOrEqual(59)
    expect(res.retryAfter).toBeLessThanOrEqual(60)
  })

  it('cross-path 不污染：先打 10 个 /api/units，再打 /api/segment/upload 应通过', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.3'
    // /api/units 走默认 60/min，打 10 次远未到上限
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, '/api/units', FULL_CFG)
    }
    // /api/segment/upload 独立 counter（key 含 path），应通过
    const res = checkRateLimit(ip, '/api/segment/upload', FULL_CFG)
    expect(res).toEqual({ allowed: true })
  })

  it('上传限流开关关闭时直接放行（独立于全局 enabled）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, uploadEnabled: false }
    const ip = '10.0.0.4'
    // 即便调很多次，开关关 → 全部放行
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip, '/api/segment/upload', cfg)).toEqual({ allowed: true })
    }
  })

  it('上传路径独立计数：/api/segment/upload 调满 10 次后第 11 次被拒', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.5'
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip, '/api/segment/upload', FULL_CFG)).toEqual({ allowed: true })
    }
    const res = checkRateLimit(ip, '/api/segment/upload', FULL_CFG)
    expect(res.allowed).toBe(false)
  })

  it('全局 enabled=0 时非上传路径放行，上传路径仍受限（uploadEnabled=true）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, enabled: false }
    const ip = '10.0.0.6'
    // 非上传路径：全局关 → 放行
    expect(checkRateLimit(ip, '/api/units', cfg)).toEqual({ allowed: true })
    // 上传路径：uploadEnabled=true → 仍受限，调 10 次后第 11 次被拒
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip, '/api/segment/upload', cfg)).toEqual({ allowed: true })
    }
    const res = checkRateLimit(ip, '/api/segment/upload', cfg)
    expect(res.allowed).toBe(false)
  })
})

// ============ checkUserRateLimit 用户级独立计数 ============

describe('checkUserRateLimit - 用户级独立计数', () => {
  it('同 IP 不同 userId 互不影响：user1 调满 10 次后第 11 次被拒，user2 第 1 次仍 allowed', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const ip = '192.168.1.1'
    for (let i = 0; i < 10; i++) {
      expect(checkUserRateLimit(ip, '/api/evaluation/auth', 1, FULL_CFG)).toEqual({
        allowed: true,
      })
    }
    const res1 = checkUserRateLimit(ip, '/api/evaluation/auth', 1, FULL_CFG)
    expect(res1.allowed).toBe(false)
    const res2 = checkUserRateLimit(ip, '/api/evaluation/auth', 2, FULL_CFG)
    expect(res2).toEqual({ allowed: true })
  })

  it('同 userId 不同 IP 也独立（key 为 userId@ip:path）', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    for (let i = 0; i < 10; i++) {
      checkUserRateLimit('1.1.1.1', '/api/evaluation/auth', 1, FULL_CFG)
    }
    expect(checkUserRateLimit('1.1.1.1', '/api/evaluation/auth', 1, FULL_CFG).allowed).toBe(false)
    expect(checkUserRateLimit('2.2.2.2', '/api/evaluation/auth', 1, FULL_CFG)).toEqual({
      allowed: true,
    })
  })

  it('cross-path 不污染：user1 调满 10 次 /api/units 后，user1 打 /api/segment/upload 仍通过', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const ip = '192.168.1.2'
    // /api/units 默认 60/min，打 10 次未到上限
    for (let i = 0; i < 10; i++) {
      checkUserRateLimit(ip, '/api/units', 1, FULL_CFG)
    }
    // 上传路径独立 counter（key 含 path），应通过
    expect(checkUserRateLimit(ip, '/api/segment/upload', 1, FULL_CFG)).toEqual({ allowed: true })
  })

  it('上传限流开关关闭时直接放行', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const cfg = { ...FULL_CFG, uploadEnabled: false }
    const ip = '192.168.1.3'
    for (let i = 0; i < 20; i++) {
      expect(checkUserRateLimit(ip, '/api/segment/upload', 1, cfg)).toEqual({ allowed: true })
    }
  })
})

// ============ getRateLimiterStats 只读探针 ============

describe('getRateLimiterStats - 滑窗水位探针', () => {
  it('初始为 0；命中限流路径后 trackedKeys 增长，maxEntries 为常量上限', async () => {
    const { checkRateLimit, getRateLimiterStats } = await loadLimiter()
    expect(getRateLimiterStats()).toEqual({ trackedKeys: 0, maxEntries: 10_000 })

    checkRateLimit('10.9.9.9', '/api/evaluation/auth', FULL_CFG)
    checkRateLimit('10.9.9.9', '/api/units', FULL_CFG)
    const stats = getRateLimiterStats()
    // ip:path 组合键：同 IP 两条路径 = 2 个桶
    expect(stats.trackedKeys).toBe(2)
    expect(stats.maxEntries).toBe(10_000)
  })
})
