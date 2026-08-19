import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// configStore（P1，D-P1-2/D-P1-6）：sys_config 双 Adapter 收敛点。
// mock 策略对齐 redisConn.test.ts 先例：vi.hoisted + vi.mock、vi.resetModules + 动态 import
// 重置模块态（内存缓存 Map）；mock '#server/utils/db'（回源 SQL）与 redisConn 连接层——
// getRedis() 返回 fake client（Redis 路径）或 null（内存 Adapter 走真逻辑）；
// ifAvailable 用保真实现（不可用→null，命令抛错→吞错返回 null），与 redisConn 真实语义一致。

interface FakeClient {
  mGet: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
}

const { mockQuery, mockGetRedis, mockIfAvailable } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetRedis: vi.fn(),
  mockIfAvailable: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/redisConn', () => ({
  getRedis: mockGetRedis,
  ifAvailable: mockIfAvailable,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // NODE_ENV=test → env 段固定 prod，key 断言稳定
  vi.stubEnv('NODE_ENV', 'test')
  // ifAvailable 保真实现：不可用直接 null；命令抛错吞错返回 null（不向调用方抛）
  mockIfAvailable.mockImplementation(async (fn: (client: FakeClient) => Promise<unknown>) => {
    const client = mockGetRedis()
    if (!client) return null
    try {
      return await fn(client)
    } catch {
      return null
    }
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// 每次拿到带干净内存缓存（模块级 Map）的实例
async function loadStore() {
  return await import('../configStore')
}

/** fake RedisClient：仅 configStore 消费的三个命令 */
function createFakeClient(): FakeClient {
  return { mGet: vi.fn(), set: vi.fn(), del: vi.fn() }
}

/** 造一行 sys_config 查询结果 */
function row(key: string, value: string) {
  return { config_key: key, config_value: value }
}

// ============ 场景 a：Redis 全命中，不回源 ============

describe('getSysConfigKeys - Redis 全命中', () => {
  it('MGET 全命中 → 直接返回 Map，不查 MySQL、不回填 SET', async () => {
    const client = createFakeClient()
    client.mGet.mockResolvedValue(['1', '30'])
    mockGetRedis.mockReturnValue(client)
    const { getSysConfigKeys } = await loadStore()

    const result = await getSysConfigKeys(['rate_limit_enabled', 'rate_limit_upload_max'])

    expect(result).toEqual(
      new Map([
        ['rate_limit_enabled', '1'],
        ['rate_limit_upload_max', '30'],
      ]),
    )
    // key 经 redisKey('cfg', ...) 构造（NODE_ENV=test → prod 段）
    expect(client.mGet).toHaveBeenCalledTimes(1)
    expect(client.mGet).toHaveBeenCalledWith([
      'ep:prod:cfg:rate_limit_enabled',
      'ep:prod:cfg:rate_limit_upload_max',
    ])
    expect(mockQuery).not.toHaveBeenCalled()
    expect(client.set).not.toHaveBeenCalled()
  })
})

// ============ 场景 b：部分命中，miss 回源 MySQL 并回填存在键 ============

describe('getSysConfigKeys - 部分命中回源回填', () => {
  it('MGET 3 键命中 1、miss 2 → IN 查询回源，返回完整 Map，存在键 SET EX 回填（TTL 抖动范围）', async () => {
    const client = createFakeClient()
    client.mGet.mockResolvedValue(['1', null, null])
    mockGetRedis.mockReturnValue(client)
    mockQuery.mockResolvedValue([row('k2', 'v2'), row('k3', 'v3')])
    const { getSysConfigKeys } = await loadStore()

    const result = await getSysConfigKeys(['k1', 'k2', 'k3'])

    expect(result).toEqual(
      new Map([
        ['k1', '1'],
        ['k2', 'v2'],
        ['k3', 'v3'],
      ]),
    )
    // 回源仅查 miss 键，SQL 为 IN 占位符
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0] as [string, string[]]
    expect(sql).toContain('FROM sys_config')
    expect(sql).toContain('IN')
    expect(params).toEqual(['k2', 'k3'])
    // 存在键回填：SET key value EX 抖动TTL（基准 10s ±10% → 整数且 [9,11]）
    expect(client.set).toHaveBeenCalledTimes(2)
    const setCalls = client.set.mock.calls as unknown as [string, string, { EX: number }][]
    for (const [key, value, opt] of setCalls) {
      expect(key.startsWith('ep:prod:cfg:')).toBe(true)
      expect(['v2', 'v3']).toContain(value)
      expect(Number.isInteger(opt.EX)).toBe(true)
      expect(opt.EX).toBeGreaterThanOrEqual(9)
      expect(opt.EX).toBeLessThanOrEqual(11)
    }
    expect(setCalls.map((c) => c[0]).sort()).toEqual(['ep:prod:cfg:k2', 'ep:prod:cfg:k3'])
  })
})

// ============ 场景 c：DB 缺键穿透（D-P1-6） ============

describe('getSysConfigKeys - DB 缺键穿透', () => {
  it('Redis 与 MySQL 均无 → 键不在返回 Map、未回填缓存，再次调用再次回源', async () => {
    const client = createFakeClient()
    client.mGet.mockResolvedValue([null])
    mockGetRedis.mockReturnValue(client)
    mockQuery.mockResolvedValue([]) // DB 也无此键
    const { getSysConfigKeys } = await loadStore()

    const first = await getSysConfigKeys(['ghost_key'])
    expect(first.size).toBe(0)
    expect(client.set).not.toHaveBeenCalled() // 不缓存缺键

    await getSysConfigKeys(['ghost_key'])
    expect(mockQuery).toHaveBeenCalledTimes(2) // 每次都穿透回源
  })
})

// ============ 场景 d：getRedis() 为 null → 内存 Map 5min 降级 ============

describe('getSysConfigKeys - 内存 Adapter 降级', () => {
  beforeEach(() => {
    mockGetRedis.mockReturnValue(null)
  })

  it('miss 回源 MySQL 回填内存；TTL 内不回源；5min 过期后重新回源', async () => {
    vi.useFakeTimers()
    mockQuery.mockResolvedValue([row('k1', 'v1')])
    const { getSysConfigKeys } = await loadStore()

    // 首次：miss 回源 + 回填内存
    const first = await getSysConfigKeys(['k1'])
    expect(first).toEqual(new Map([['k1', 'v1']]))
    expect(mockQuery).toHaveBeenCalledTimes(1)

    // TTL 内：内存命中，不再回源
    const second = await getSysConfigKeys(['k1'])
    expect(second).toEqual(new Map([['k1', 'v1']]))
    expect(mockQuery).toHaveBeenCalledTimes(1)

    // 快进 5min+1ms：过期 → 重新回源
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    const third = await getSysConfigKeys(['k1'])
    expect(third).toEqual(new Map([['k1', 'v1']]))
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('内存路径不触发任何 Redis 命令', async () => {
    mockQuery.mockResolvedValue([row('k1', 'v1')])
    const { getSysConfigKeys } = await loadStore()

    await getSysConfigKeys(['k1'])

    expect(mockIfAvailable).not.toHaveBeenCalled()
  })
})

// ============ 场景 e：invalidateSysConfig 失效 ============

describe('invalidateSysConfig - DEL 失效', () => {
  it('Redis 可用 → DEL 对应 cfg 键；DEL 抛错静默不抛出（靠 ≤10s TTL 自愈）', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    const { invalidateSysConfig } = await loadStore()

    await invalidateSysConfig('k1')
    expect(client.del).toHaveBeenCalledWith('ep:prod:cfg:k1')

    // DEL 抛错 → ifAvailable 吞错，invalidateSysConfig 正常返回（不 reject）
    client.del.mockRejectedValue(new Error('WRONGTYPE'))
    await expect(invalidateSysConfig('k1')).resolves.toBeUndefined()
  })

  it('同时清内存缓存键：降级态回填后再 invalidate → 下次读取重新回源', async () => {
    vi.useFakeTimers()
    mockGetRedis.mockReturnValue(null)
    mockQuery.mockResolvedValue([row('k1', 'v1')])
    const { getSysConfigKeys, invalidateSysConfig } = await loadStore()

    await getSysConfigKeys(['k1']) // 回填内存
    await getSysConfigKeys(['k1']) // 内存命中
    expect(mockQuery).toHaveBeenCalledTimes(1)

    await invalidateSysConfig('k1') // 清内存键

    await getSysConfigKeys(['k1']) // 重新回源
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})

// ============ 场景 f：并发 miss 各自回源（不加 single-flight） ============

describe('getSysConfigKeys - 并发回源不合并', () => {
  it('两个并发 miss 各自回源 MySQL（多次 db.query 可接受，与现状语义一致）', async () => {
    mockGetRedis.mockReturnValue(null)
    mockQuery.mockResolvedValue([row('k1', 'v1')])
    const { getSysConfigKeys } = await loadStore()

    const [p1, p2] = [getSysConfigKeys(['k1']), getSysConfigKeys(['k1'])]
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toEqual(new Map([['k1', 'v1']]))
    expect(r2).toEqual(new Map([['k1', 'v1']]))
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})
