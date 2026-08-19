import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// redisMonitor（P4 后续可视化 Task 2）：INFO 摘要解析 + SCAN/TTL 按域统计，并入 monitor 聚合快照。
// mock 策略对齐 semaphore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回 fake client
// 或 null）+ vi.resetModules + 动态 import 重置模块态；logger mock 化（对齐先例，保持 mock 面）。
// useRuntimeConfig 经 vi.stubGlobal 桩（对齐 redisConn.test.ts 的 stubRedisConfig 先例）。
// 注意：redisMonitor 在函数内动态 import redisConn，getRedis 运行时才取，故必须在调用
// getRedisMonitorStat 之前设好 mockGetRedis 返回值。
// 覆盖：① INFO 解析 ② SCAN 域统计 ③ getRedis()=null 降级 ④ 未配置 / 无 useRuntimeConfig 降级
// ⑤ 命令抛错降级（info / scan 两路径）。

interface FakeClient {
  info: ReturnType<typeof vi.fn>
  scan: ReturnType<typeof vi.fn>
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
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** stub useRuntimeConfig().redis（默认已配置，可覆盖三项；对齐 redisConn.test.ts 先例） */
function stubRedisConfig(cfg: { host?: string; port?: string; password?: string } = {}) {
  vi.stubGlobal('useRuntimeConfig', () => ({
    redis: { host: '127.0.0.1', port: '6379', password: '', ...cfg },
  }))
}

/** 每次拿到干净的模块实例（getRedisMonitorStat 无模块态，重载仅为隔离 mock 状态） */
async function loadMonitor() {
  return await import('../redisMonitor')
}

/** fake Redis client：仅 redisMonitor 消费的 info/scan/ttl 三命令 */
function createFakeClient(): FakeClient {
  return { info: vi.fn(), scan: vi.fn(), ttl: vi.fn() }
}

// ============ ① INFO 解析 ============

describe('INFO 解析', () => {
  it('KEY:value 行映射为数字/布尔摘要，其余行（含 Keyspace 冒号行）忽略', async () => {
    stubRedisConfig({ host: '127.0.0.1' })
    const client = createFakeClient()
    client.info.mockResolvedValue(
      [
        '# Server',
        'redis_version:7.2.0',
        '# Memory',
        'used_memory:1048576',
        'maxmemory:0',
        '# Clients',
        'connected_clients:5',
        '# Persistence',
        'rdb_last_bgsave_time_sec:12',
        'rdb_bgsave_in_progress:0',
        '# Keyspace',
        'db0:keys=10,expires=8,avg_ttl=5000',
      ].join('\n'),
    )
    client.scan.mockResolvedValue({ cursor: '0', keys: [] })
    mockGetRedis.mockReturnValue(client)
    const { getRedisMonitorStat } = await loadMonitor()

    const stat = await getRedisMonitorStat()

    expect(stat.configured).toBe(true)
    expect(stat.online).toBe(true)
    expect(stat.info).toEqual({
      version: '7.2.0',
      usedMemoryBytes: 1048576,
      maxMemoryBytes: 0,
      connectedClients: 5,
      rdbLastBgsaveAgoSec: 12,
      rdbBgsaveInProgress: false,
    })
    expect(stat.domains).toEqual({})
  })
})

// ============ ② SCAN 域统计 ============

describe('SCAN 域统计', () => {
  it('多页 SCAN + 逐 key TTL：按域聚合（expiring/noTtl），白名单外前缀归 other', async () => {
    stubRedisConfig({ host: '127.0.0.1' })
    const client = createFakeClient()
    client.info.mockResolvedValue('redis_version:7.2.0\n')
    client.scan
      .mockResolvedValueOnce({
        cursor: '1',
        keys: ['ep:prod:cfg:sys_config', 'ep:prod:rl:ip:1.2.3.4:/api/x'],
      })
      .mockResolvedValueOnce({
        cursor: '0',
        keys: ['ep:prod:rl:ip:1.1.1.1:/api/y', 'ep:prod:unknown:whatever', 'weird-key'],
      })
    const ttlByKey: Record<string, number> = {
      'ep:prod:cfg:sys_config': -1,
      'ep:prod:rl:ip:1.2.3.4:/api/x': 60,
      'ep:prod:rl:ip:1.1.1.1:/api/y': 300,
      'ep:prod:unknown:whatever': 5,
      'weird-key': -1,
    }
    client.ttl.mockImplementation(async (key: string): Promise<number> => ttlByKey[key] ?? -2)
    mockGetRedis.mockReturnValue(client)
    const { getRedisMonitorStat } = await loadMonitor()

    const stat = await getRedisMonitorStat()

    // 两轮 SCAN：cursor '0'（继续）→ '1' → '0'（结束）
    expect(client.scan).toHaveBeenCalledTimes(2)
    expect(client.scan).toHaveBeenNthCalledWith(1, '0', { COUNT: 1000 })
    expect(client.scan).toHaveBeenNthCalledWith(2, '1', { COUNT: 1000 })
    // cfg：TTL=-1 → noTtl=1；rl：TTL>0 → expiring=2；未知前缀 'unknown' 与无前缀 'weird-key' → other
    expect(stat.domains).toEqual({
      cfg: { keys: 1, expiring: 0, noTtl: 1 },
      rl: { keys: 2, expiring: 2, noTtl: 0 },
      other: { keys: 2, expiring: 1, noTtl: 1 },
    })
  })
})

// ============ ③ getRedis()=null 降级 ============

describe('Redis 不可用降级', () => {
  it('getRedis()=null → online=false、info/domains=null、configured=true，不抛错', async () => {
    stubRedisConfig({ host: '127.0.0.1' })
    mockGetRedis.mockReturnValue(null)
    const { getRedisMonitorStat } = await loadMonitor()

    expect(await getRedisMonitorStat()).toEqual({
      configured: true,
      online: false,
      info: null,
      domains: null,
    })
  })
})

// ============ ④ 未配置 / 无 useRuntimeConfig 降级 ============

describe('未配置降级', () => {
  it('NUXT_REDIS_HOST 为空 → configured=false、online=false', async () => {
    stubRedisConfig({ host: '' })
    mockGetRedis.mockReturnValue(null)
    const { getRedisMonitorStat } = await loadMonitor()

    expect(await getRedisMonitorStat()).toEqual({
      configured: false,
      online: false,
      info: null,
      domains: null,
    })
  })

  it('环境无 useRuntimeConfig → configured 默认 false（guard 兜底，不抛错）', async () => {
    mockGetRedis.mockReturnValue(null)
    const { getRedisMonitorStat } = await loadMonitor()

    expect(await getRedisMonitorStat()).toEqual({
      configured: false,
      online: false,
      info: null,
      domains: null,
    })
  })
})

// ============ ⑤ 命令抛错降级 ============

describe('命令异常降级', () => {
  it('info 抛错 → online=false 降级，不抛错', async () => {
    stubRedisConfig({ host: '127.0.0.1' })
    const client = createFakeClient()
    client.info.mockRejectedValue(new Error('CONNECTION RESET'))
    mockGetRedis.mockReturnValue(client)
    const { getRedisMonitorStat } = await loadMonitor()

    expect(await getRedisMonitorStat()).toEqual({
      configured: true,
      online: false,
      info: null,
      domains: null,
    })
  })

  it('scan 抛错（scanDomains 路径）同样降级，不抛错', async () => {
    stubRedisConfig({ host: '127.0.0.1' })
    const client = createFakeClient()
    client.info.mockResolvedValue('redis_version:7.2.0\n')
    client.scan.mockRejectedValue(new Error('READONLY'))
    mockGetRedis.mockReturnValue(client)
    const { getRedisMonitorStat } = await loadMonitor()

    expect(await getRedisMonitorStat()).toEqual({
      configured: true,
      online: false,
      info: null,
      domains: null,
    })
  })
})
