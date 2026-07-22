import { describe, it, expect, vi, beforeEach } from 'vitest'

// rateLimiter 有模块级 windowMap（滑动窗口状态）与 cachedSwitches（5min 缓存），
// 测试之间会互相污染。每个用例前 vi.resetModules() 并动态重新 import，保证干净状态。

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// 每次拿到带干净 windowMap / cachedSwitches 的模块实例
async function loadLimiter() {
  return await import('../rateLimiter')
}

// ============ getRateLimitConfig 开关读取 ============

describe('getRateLimitConfig - 开关读取', () => {
  it('enabled=1, ipLevel=1, userLevel=1 → 返回全 true', async () => {
    mockQuery.mockResolvedValueOnce([
      { config_key: 'rate_limit_enabled', config_value: '1' },
      { config_key: 'rate_limit_ip_level', config_value: '1' },
      { config_key: 'rate_limit_user_level', config_value: '1' },
    ])
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({ enabled: true, ipLevel: true, userLevel: true })
  })

  it('enabled=0 → 返回 { enabled: false, ipLevel: true, userLevel: true }', async () => {
    mockQuery.mockResolvedValueOnce([
      { config_key: 'rate_limit_enabled', config_value: '0' },
      { config_key: 'rate_limit_ip_level', config_value: '1' },
      { config_key: 'rate_limit_user_level', config_value: '1' },
    ])
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({ enabled: false, ipLevel: true, userLevel: true })
  })

  it('query 抛错 → 回退默认全 true { enabled: true, ipLevel: true, userLevel: true }', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const { getRateLimitConfig } = await loadLimiter()
    const cfg = await getRateLimitConfig()
    expect(cfg).toEqual({ enabled: true, ipLevel: true, userLevel: true })
  })

  it('缓存：连续两次调用只查一次 db；invalidateRateLimitCache 后再调用会再查一次', async () => {
    mockQuery.mockResolvedValue([
      { config_key: 'rate_limit_enabled', config_value: '1' },
      { config_key: 'rate_limit_ip_level', config_value: '1' },
      { config_key: 'rate_limit_user_level', config_value: '1' },
    ])
    const { getRateLimitConfig, invalidateRateLimitCache } = await loadLimiter()
    await getRateLimitConfig()
    await getRateLimitConfig()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    invalidateRateLimitCache()
    await getRateLimitConfig()
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})

// ============ checkRateLimit IP 级 ============

describe('checkRateLimit - IP 级限流', () => {
  it('未超限返回 { allowed: true }', async () => {
    const { checkRateLimit } = await loadLimiter()
    const res = checkRateLimit('1.2.3.4', '/api/units')
    expect(res).toEqual({ allowed: true })
  })

  it('超限：对 /api/evaluation/auth 调 11 次，第 11 次被拒', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.1'
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip, '/api/evaluation/auth')).toEqual({ allowed: true })
    }
    const res = checkRateLimit(ip, '/api/evaluation/auth')
    expect(res.allowed).toBe(false)
    expect(res.retryAfter).toBeGreaterThan(0)
  })

  it('retryAfter 约等于 60（窗口 60s）', async () => {
    const { checkRateLimit } = await loadLimiter()
    const ip = '10.0.0.2'
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, '/api/evaluation/auth')
    }
    const res = checkRateLimit(ip, '/api/evaluation/auth')
    // 窗口 60s，连续调用耗时极短，retryAfter 应在 [59, 60]
    expect(res.retryAfter).toBeGreaterThanOrEqual(59)
    expect(res.retryAfter).toBeLessThanOrEqual(60)
  })
})

// ============ checkUserRateLimit 用户级独立计数 ============

describe('checkUserRateLimit - 用户级独立计数', () => {
  it('同 IP 不同 userId 互不影响：user1 调满 10 次后第 11 次被拒，user2 第 1 次仍 allowed', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    const ip = '192.168.1.1'
    for (let i = 0; i < 10; i++) {
      expect(checkUserRateLimit(ip, '/api/evaluation/auth', 1)).toEqual({ allowed: true })
    }
    const res1 = checkUserRateLimit(ip, '/api/evaluation/auth', 1)
    expect(res1.allowed).toBe(false)
    const res2 = checkUserRateLimit(ip, '/api/evaluation/auth', 2)
    expect(res2).toEqual({ allowed: true })
  })

  it('同 userId 不同 IP 也独立（key 为 userId@ip）：user1@ip1 调满 10 次后，user1@ip2 仍 allowed', async () => {
    const { checkUserRateLimit } = await loadLimiter()
    for (let i = 0; i < 10; i++) {
      checkUserRateLimit('1.1.1.1', '/api/evaluation/auth', 1)
    }
    expect(checkUserRateLimit('1.1.1.1', '/api/evaluation/auth', 1).allowed).toBe(false)
    expect(checkUserRateLimit('2.2.2.2', '/api/evaluation/auth', 1)).toEqual({ allowed: true })
  })
})
