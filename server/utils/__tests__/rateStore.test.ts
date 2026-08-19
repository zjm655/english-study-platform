import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// rateStore（P2 Task 1，D-P2-2/D-P2-4）：限流/防爆破/游客计数统一固窗计数基建。
// mock 策略对齐 configStore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回
// fake client 或 null），内存 Adapter 走真逻辑；vi.resetModules + 动态 import 重置模块态
// （内存计数 Map）；logger mock 化以便断言降级 warn 留痕。
// 覆盖（对应 tasks.md SubTask 1.1）：① 固窗计数与 TTL 语义 ② refreshTtl 模式
// ③ getCount 无副作用 ④ resetKey ⑤ Redis 命令异常降级 ⑥ getRedis()=null 内存同语义
// ⑦ 内存 Map 软上限 FIFO 淘汰。

interface FakeClient {
  incr: ReturnType<typeof vi.fn>
  expire: ReturnType<typeof vi.fn>
  ttl: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
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
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// 每次拿到带干净内存计数 Map（模块级单例）的实例
async function loadStore() {
  return await import('../rateStore')
}

/** fake RedisClient：仅 rateStore 消费的五个命令 */
function createFakeClient(): FakeClient {
  return { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn(), get: vi.fn(), del: vi.fn() }
}

// ============ ① 固窗计数：Redis 路径 ============

describe('incrWindow - Redis 路径固窗计数', () => {
  it('同 key 连续三次 incr → count 1/2/3；仅 count===1 时 EXPIRE 种 TTL；retryAfterSec 取 TTL 命令返回', async () => {
    const client = createFakeClient()
    client.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValueOnce(60).mockResolvedValueOnce(42).mockResolvedValueOnce(7)
    mockGetRedis.mockReturnValue(client)
    const { incrWindow } = await loadStore()

    const key = 'ep:prod:rl:ip:1.2.3.4:/api/client-error'
    const r1 = await incrWindow('rl', 'ip:1.2.3.4:/api/client-error', 60)
    const r2 = await incrWindow('rl', 'ip:1.2.3.4:/api/client-error', 60)
    const r3 = await incrWindow('rl', 'ip:1.2.3.4:/api/client-error', 60)

    expect(r1).toEqual({ count: 1, retryAfterSec: 60 })
    expect(r2).toEqual({ count: 2, retryAfterSec: 42 })
    expect(r3).toEqual({ count: 3, retryAfterSec: 7 })
    // key 内部经 redisKey(domain, id) 构造（调用方传 domain+id）
    expect(client.incr).toHaveBeenCalledTimes(3)
    expect(client.incr).toHaveBeenNthCalledWith(1, key)
    expect(client.incr).toHaveBeenNthCalledWith(2, key)
    expect(client.incr).toHaveBeenNthCalledWith(3, key)
    // 默认模式仅新窗口首计数（count===1）种 TTL，EXPIRE 参数 = windowSec
    expect(client.expire).toHaveBeenCalledTimes(1)
    expect(client.expire).toHaveBeenCalledWith(key, 60)
    // 剩余 TTL 经 TTL 命令获取
    expect(client.ttl).toHaveBeenCalledTimes(3)
    expect(client.ttl).toHaveBeenCalledWith(key)
  })

  it('窗口过期后新窗口首计数：incr 回 1 → EXPIRE 重种（键过期语义由 Redis 服务端保证）', async () => {
    const client = createFakeClient()
    // 第三次返回 1 模拟「窗口已过期、新窗口首计数」
    client.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(60)
    mockGetRedis.mockReturnValue(client)
    const { incrWindow } = await loadStore()

    await incrWindow('rl', 'ip:1.1.1.1:/api/x', 60)
    await incrWindow('rl', 'ip:1.1.1.1:/api/x', 60)
    const third = await incrWindow('rl', 'ip:1.1.1.1:/api/x', 60)

    expect(third.count).toBe(1)
    expect(third.retryAfterSec).toBe(60)
    // 两次 count===1 各种一次 TTL（窗口过期后 TTL 重种）
    expect(client.expire).toHaveBeenCalledTimes(2)
    expect(client.expire).toHaveBeenLastCalledWith('ep:prod:rl:ip:1.1.1.1:/api/x', 60)
  })
})

// ============ ①⑥ 固窗计数：内存路径（getRedis()=null 降级同语义） ============

describe('incrWindow - 内存路径固窗计数（getRedis() 为 null）', () => {
  beforeEach(() => {
    mockGetRedis.mockReturnValue(null)
  })

  it('连续三次 incr → count 1/2/3，retryAfterSec 随过期临近递减；窗口过期后回 1 且 TTL 重种', async () => {
    vi.useFakeTimers()
    const { incrWindow } = await loadStore()

    const r1 = await incrWindow('rl', 'ip:1.1.1.1:/api/y', 60)
    expect(r1).toEqual({ count: 1, retryAfterSec: 60 })

    vi.advanceTimersByTime(10_000) // t=10s
    const r2 = await incrWindow('rl', 'ip:1.1.1.1:/api/y', 60)
    expect(r2).toEqual({ count: 2, retryAfterSec: 50 }) // 剩余 50s（默认模式不刷新）

    vi.advanceTimersByTime(30_000) // t=40s
    const r3 = await incrWindow('rl', 'ip:1.1.1.1:/api/y', 60)
    expect(r3).toEqual({ count: 3, retryAfterSec: 20 })

    vi.advanceTimersByTime(60_000) // t=100s，超过窗口起点 t=0 起算的 60s
    const r4 = await incrWindow('rl', 'ip:1.1.1.1:/api/y', 60)
    expect(r4).toEqual({ count: 1, retryAfterSec: 60 }) // 新窗口：计数归 1、TTL 重种
  })
})

// ============ ② refreshTtl 模式（fail 域） ============

describe('incrWindow - refreshTtl 模式', () => {
  it('Redis 路径：opts.refreshTtl=true → 每次 incr 都 EXPIRE 刷新（区别于默认仅 count===1 时种）', async () => {
    const client = createFakeClient()
    client.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(1800)
    mockGetRedis.mockReturnValue(client)
    const { incrWindow } = await loadStore()

    await incrWindow('fail', 'user:42', 1800, { refreshTtl: true })
    await incrWindow('fail', 'user:42', 1800, { refreshTtl: true })
    await incrWindow('fail', 'user:42', 1800, { refreshTtl: true })

    expect(client.expire).toHaveBeenCalledTimes(3)
    expect(client.expire).toHaveBeenNthCalledWith(1, 'ep:prod:fail:user:42', 1800)
    expect(client.expire).toHaveBeenNthCalledWith(3, 'ep:prod:fail:user:42', 1800)
  })

  it('内存路径：refreshTtl=true 每次刷新 expiresAt（保持「最后一次失败后 30min 清零」语义）', async () => {
    vi.useFakeTimers()
    mockGetRedis.mockReturnValue(null)
    const { incrWindow, getCount } = await loadStore()

    await incrWindow('fail', 'user:42', 1800, { refreshTtl: true }) // t=0，expiresAt=1800s
    vi.advanceTimersByTime(1_700_000) // t=28min20s，默认模式仅剩 100s
    const r = await incrWindow('fail', 'user:42', 1800, { refreshTtl: true })
    expect(r.count).toBe(2)
    expect(r.retryAfterSec).toBe(1800) // 已刷新回满窗口

    vi.advanceTimersByTime(1_700_000) // t=56min40s：若未刷新早已过期，刷新后仍存活
    expect(await getCount('fail', 'user:42')).toBe(2)

    vi.advanceTimersByTime(101_000) // 距最后一次刷新 30min+1s → 过期清零
    expect(await getCount('fail', 'user:42')).toBe(0)
  })
})

// ============ ③ getCount 无副作用 ============

describe('getCount - 无副作用读', () => {
  it('Redis 路径：GET miss → 0，不触发任何写命令；GET 命中 → 解析计数', async () => {
    const client = createFakeClient()
    client.get.mockResolvedValueOnce(null).mockResolvedValueOnce('7')
    mockGetRedis.mockReturnValue(client)
    const { getCount } = await loadStore()

    expect(await getCount('rl', 'ghost')).toBe(0)
    expect(await getCount('rl', 'hit')).toBe(7)
    expect(client.get).toHaveBeenNthCalledWith(1, 'ep:prod:rl:ghost')
    expect(client.get).toHaveBeenNthCalledWith(2, 'ep:prod:rl:hit')
    expect(client.incr).not.toHaveBeenCalled()
    expect(client.expire).not.toHaveBeenCalled()
    expect(client.del).not.toHaveBeenCalled()
  })

  it('内存路径：不存在/已过期 = 0，不创建键（过期后 incr 从 1 起计、TTL 重种）', async () => {
    vi.useFakeTimers()
    mockGetRedis.mockReturnValue(null)
    const { incrWindow, getCount } = await loadStore()

    expect(await getCount('rl', 'ghost')).toBe(0) // 不存在

    await incrWindow('rl', 'k', 60)
    expect(await getCount('rl', 'k')).toBe(1)

    vi.advanceTimersByTime(61_000) // 过期
    expect(await getCount('rl', 'k')).toBe(0) // 已过期 = 0

    const r = await incrWindow('rl', 'k', 60)
    expect(r).toEqual({ count: 1, retryAfterSec: 60 }) // 重开新窗口（getCount 未建键/未续期）
  })
})

// ============ ④ resetKey 清零 ============

describe('resetKey - 清零', () => {
  it('Redis DEL 被调 + 内存键同步删除（降级期残留一并清理）', async () => {
    const client = createFakeClient()
    client.del.mockResolvedValue(1)
    // 先降级态攒内存计数
    mockGetRedis.mockReturnValue(null)
    const { incrWindow, getCount, resetKey } = await loadStore()
    await incrWindow('rl', 'k', 60)
    await incrWindow('rl', 'k', 60)
    expect(await getCount('rl', 'k')).toBe(2)

    // 恢复 Redis 后 resetKey：DEL 被调 + 内存键删除
    mockGetRedis.mockReturnValue(client)
    await resetKey('rl', 'k')
    expect(client.del).toHaveBeenCalledWith('ep:prod:rl:k')

    mockGetRedis.mockReturnValue(null)
    expect(await getCount('rl', 'k')).toBe(0)
    const r = await incrWindow('rl', 'k', 60)
    expect(r.count).toBe(1) // 清零后从 1 重新起计
  })

  it('纯内存路径：删除后 getCount=0、再 incr 从 1 起', async () => {
    mockGetRedis.mockReturnValue(null)
    const { incrWindow, getCount, resetKey } = await loadStore()
    await incrWindow('fail', 'u1', 1800, { refreshTtl: true })
    await incrWindow('fail', 'u1', 1800, { refreshTtl: true })
    expect(await getCount('fail', 'u1')).toBe(2)

    await resetKey('fail', 'u1')
    expect(await getCount('fail', 'u1')).toBe(0)
    expect((await incrWindow('fail', 'u1', 1800)).count).toBe(1)
  })
})

// ============ ⑤ Redis 命令异常 → 降级内存路径 ============

describe('Redis 命令异常 - 降级内存路径', () => {
  it('incr 抛错 → catch 降级内存返回正常结果 + logger.warn 留痕、不上抛', async () => {
    const client = createFakeClient()
    client.incr.mockRejectedValue(new Error('CONNECTION RESET'))
    mockGetRedis.mockReturnValue(client)
    const { incrWindow, getCount } = await loadStore()

    const r1 = await incrWindow('rl', 'k', 60)
    expect(r1).toEqual({ count: 1, retryAfterSec: 60 }) // 内存路径接住

    const r2 = await incrWindow('rl', 'k', 60)
    expect(r2.count).toBe(2) // 连续降级期间内存计数连续

    // 降级期写入的计数在内存可读（getCount 仅在 Redis 不可用时读内存镜像）
    mockGetRedis.mockReturnValue(null)
    expect(await getCount('rl', 'k')).toBe(2)
    expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    expect(mockLogger.warn).toHaveBeenNthCalledWith(1, expect.stringContaining('[rateStore]'))
    expect(mockLogger.warn).toHaveBeenNthCalledWith(1, expect.stringContaining('CONNECTION RESET'))
  })

  it('恢复后自动切回 Redis 路径（无熔断态，下一次调用直接重试）', async () => {
    const client = createFakeClient()
    client.incr.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(5)
    client.ttl.mockResolvedValue(30)
    mockGetRedis.mockReturnValue(client)
    const { incrWindow } = await loadStore()

    const degraded = await incrWindow('rl', 'k', 60)
    expect(degraded.count).toBe(1) // 异常 → 内存路径

    const recovered = await incrWindow('rl', 'k', 60)
    expect(recovered).toEqual({ count: 5, retryAfterSec: 30 }) // 恢复 → Redis 路径
    expect(client.incr).toHaveBeenCalledTimes(2)
  })

  it('get 抛错 → 降级内存读取（warn 留痕不上抛）；del 抛错 → warn 留痕且内存键仍被删除', async () => {
    const client = createFakeClient()
    client.get.mockRejectedValue(new Error('GET FAILED'))
    client.del.mockRejectedValue(new Error('DEL FAILED'))
    mockGetRedis.mockReturnValue(client)
    const { incrWindow, getCount, resetKey } = await loadStore()

    // 先降级态攒内存计数，再切回「命令会失败」的 client
    mockGetRedis.mockReturnValue(null)
    await incrWindow('rl', 'k', 60)
    mockGetRedis.mockReturnValue(client)

    expect(await getCount('rl', 'k')).toBe(1) // get 抛错 → 内存读取
    await resetKey('rl', 'k') // del 抛错 → 不上抛
    mockGetRedis.mockReturnValue(null)
    expect(await getCount('rl', 'k')).toBe(0) // 内存键仍被删除

    expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    expect(mockLogger.warn).toHaveBeenNthCalledWith(1, expect.stringContaining('GET FAILED'))
    expect(mockLogger.warn).toHaveBeenNthCalledWith(2, expect.stringContaining('DEL FAILED'))
  })
})

// ============ ⑦ 内存 Map 软上限 FIFO 淘汰 ============

describe('内存 Map 软上限 FIFO 淘汰', () => {
  it('超过软上限（50_000，对齐 guest 域现状防护）时淘汰最早创建的键，新键仍正常计数', async () => {
    mockGetRedis.mockReturnValue(null)
    const { incrWindow, getCount } = await loadStore()

    // 注入 50_000 个不同键（未超限，最早键仍在）
    for (let i = 0; i < 50_000; i++) {
      await incrWindow('rl', `k${i}`, 60)
    }
    expect(await getCount('rl', 'k0')).toBe(1)

    // 第 50_001 个新键：触发淘汰最旧（k0），而非拒绝新键
    const r = await incrWindow('rl', 'brand-new', 60)
    expect(r.count).toBe(1)
    expect(await getCount('rl', 'k0')).toBe(0) // 最旧键被 FIFO 淘汰
    expect(await getCount('rl', 'k1')).toBe(1) // 次旧键仍在
    expect(await getCount('rl', 'brand-new')).toBe(1)
  })
})

// ============ ⑧ getRateStoreStats 只读探针 ============

describe('getRateStoreStats - 只读探针', () => {
  it('内存路径：条目数随不同 id 计数增长（同 id 不新增条目），上限为内存软上限常量', async () => {
    mockGetRedis.mockReturnValue(null)
    const { incrWindow, getRateStoreStats } = await loadStore()

    expect(getRateStoreStats()).toEqual({ memoryEntries: 0, memoryMaxEntries: 50_000 })

    await incrWindow('rl', 'a', 60)
    await incrWindow('rl', 'b', 60)
    await incrWindow('rl', 'a', 60) // 同 id 重复计数不新增条目
    expect(getRateStoreStats()).toEqual({ memoryEntries: 2, memoryMaxEntries: 50_000 })
  })

  it('Redis 激活时 memoryEntries=0 属正常（计数在 Redis，内存镜像不写入）', async () => {
    const client = createFakeClient()
    client.incr.mockResolvedValue(1)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(60)
    mockGetRedis.mockReturnValue(client)
    const { incrWindow, getRateStoreStats } = await loadStore()

    await incrWindow('rl', 'a', 60)
    expect(getRateStoreStats()).toEqual({ memoryEntries: 0, memoryMaxEntries: 50_000 })
  })
})
