import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// rateLimitHitThrottle（P4，TECH_DEBT #1 缺口 6）：限流命中安全告警节流外置——
// 复用 rateStore 固定窗口计数（Redis + 内存双 Adapter），使 10 分钟 / IP 的告警节流
// 在多实例间共享（替代原 apiCallLogger 进程内 Map，杜绝多实例重复告警）。
// mock 策略对齐 rateStore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回
// fake client 或 null），内存 Adapter 走真逻辑；vi.resetModules + 动态 import 重置模块态
// （rateStore 内存计数 Map）；logger mock 化。
// 覆盖：① 首次命中返回 true ② 同 IP 同窗口二次命中返回 false ③ 不同 IP 独立计数
// ④ 窗口过期（>600s）后同 IP 恢复 true ⑤ Redis 路径验证 'evt' 域 key 接线 + 跨实例去重。

interface FakeClient {
  incr: ReturnType<typeof vi.fn>
  expire: ReturnType<typeof vi.fn>
  ttl: ReturnType<typeof vi.fn>
}

const { mockGetRedis, mockLogger } = vi.hoisted(() => ({
  mockGetRedis: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('#server/utils/redisConn', () => ({ getRedis: mockGetRedis }))
vi.mock('#shared/utils/logger', () => ({ logger: mockLogger }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // NODE_ENV=test → env 段固定 prod，key 断言稳定
  vi.stubEnv('NODE_ENV', 'test')
  // 默认走内存 Adapter 路径（getRedis() 为 null 时 rateStore 降级内存 Map 镜像）
  mockGetRedis.mockReturnValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// 每次拿到带干净模块态（rateStore 内存计数 Map）的实例
async function loadThrottle() {
  return await import('../rateLimitHitThrottle')
}

// ============ ① 首次命中 / ② 同窗口二次命中（内存路径） ============

describe('shouldLogRateLimitHit - 内存路径固窗节流（getRedis() 为 null）', () => {
  it('首次命中返回 true；同 IP 同 10min 窗口内二次/三次命中返回 false（每窗口仅告警一条）', async () => {
    const { shouldLogRateLimitHit } = await loadThrottle()

    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(true)
    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(false)
    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(false)
  })

  it('不同 IP 计数互相独立（各自独立 10min 窗口，互不挤占）', async () => {
    const { shouldLogRateLimitHit } = await loadThrottle()

    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(true)
    expect(await shouldLogRateLimitHit('5.6.7.8')).toBe(true) // 不同 IP 不受 1.2.3.4 影响
    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(false) // 仍处于自身窗口内
    expect(await shouldLogRateLimitHit('5.6.7.8')).toBe(false)
  })

  it('窗口过期（推进 >600s）后同 IP 恢复可告警（计数归零重开新窗口）', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T00:00:00.000Z'))
    const { shouldLogRateLimitHit } = await loadThrottle()

    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(true)
    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(false)

    // 推进 601s（> 600s 窗口）：内存 Adapter 按 expiresAt 判定，窗口过期重开
    vi.advanceTimersByTime(601_000)
    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(true)
    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(false) // 新窗口内再次占用
  })
})

// ============ ⑤ Redis 路径：'evt' 域 key 接线 + 跨实例去重 ============

describe('shouldLogRateLimitHit - Redis 路径（getRedis() 返回 fake client）', () => {
  it("incr 使用 evt 域 key 'ep:prod:evt:rate_limit_hit:{ip}'（证明告警节流走共享计数域）", async () => {
    const client: FakeClient = { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() }
    client.incr.mockResolvedValue(1)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(600)
    mockGetRedis.mockReturnValue(client)
    const { shouldLogRateLimitHit } = await loadThrottle()

    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(true)
    expect(client.incr).toHaveBeenCalledWith('ep:prod:evt:rate_limit_hit:1.2.3.4')
    // 仅新窗口首计数（count===1）种 TTL，窗口 600s
    expect(client.expire).toHaveBeenCalledWith('ep:prod:evt:rate_limit_hit:1.2.3.4', 600)
  })

  it('Redis 返回 count≥2 时返回 false（跨实例共享：另一实例已告警过，本实例不再重复告警）', async () => {
    const client: FakeClient = { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() }
    client.incr.mockResolvedValue(3) // 模拟他实例已计数 2 次、当前为第 3 次
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(500)
    mockGetRedis.mockReturnValue(client)
    const { shouldLogRateLimitHit } = await loadThrottle()

    expect(await shouldLogRateLimitHit('1.2.3.4')).toBe(false)
    expect(client.incr).toHaveBeenCalledWith('ep:prod:evt:rate_limit_hit:1.2.3.4')
    expect(client.expire).not.toHaveBeenCalled() // 非首计数不种 TTL（默认模式）
  })
})
