import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// cloudHealthDedup（P4 多实例去重）：云健康骤升告警去重——复用 rateStore 固窗计数，
// 同一 service 30 分钟内仅首次骤升上报。mock 策略对齐 rateStore.test.ts 先例：
// vi.hoisted + vi.mock redisConn（getRedis 返回 fake client 或 null，内存 Adapter 走真逻辑）；
// vi.resetModules + 动态 import 重置模块态（rateStore 内存计数 Map 单例）；logger mock 化。
// 覆盖：① 首测上报 true ② 30 分钟内同 service 二次 false ③ 不同 service 互不影响 true
// ④ 窗口过期（>1800s）后同 service 重新上报 true ⑤ Redis 路径断言 key 装配（evt 域 + id）。

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
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// 每次拿到带干净内存计数 Map（rateStore 模块级单例）的实例
async function loadDedup() {
  return await import('../cloudHealthDedup')
}

/** fake RedisClient：cloudHealthDedup 经 rateStore 消费的 incr/expire/ttl 命令 */
function createFakeClient(): FakeClient {
  return { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() }
}

// ============ ① 内存路径：首测/窗口内重复/异 service ============

describe('shouldReportCloudHealthSpike - 内存路径（getRedis() 为 null）', () => {
  beforeEach(() => {
    mockGetRedis.mockReturnValue(null)
  })

  it('首测上报 true；30 分钟内同 service 二次 false；不同 service 互不影响 true', async () => {
    vi.useFakeTimers()
    const { shouldReportCloudHealthSpike } = await loadDedup()

    expect(await shouldReportCloudHealthSpike('tts')).toBe(true) // 首测 → true
    expect(await shouldReportCloudHealthSpike('tts')).toBe(false) // 窗口内二次 → false
    expect(await shouldReportCloudHealthSpike('nls')).toBe(true) // 异 service → true
  })

  it('窗口过期（>1800s）后同 service 重新上报 true', async () => {
    vi.useFakeTimers()
    const { shouldReportCloudHealthSpike } = await loadDedup()

    expect(await shouldReportCloudHealthSpike('tts')).toBe(true)
    expect(await shouldReportCloudHealthSpike('tts')).toBe(false)

    // 推进超过 30 分钟固窗 → 窗口重置，同 service 重新进入「首测」状态
    vi.setSystemTime(Date.now() + 1_801_000)
    expect(await shouldReportCloudHealthSpike('tts')).toBe(true)
    expect(await shouldReportCloudHealthSpike('tts')).toBe(false)
  })
})

// ============ ⑤ Redis 路径：key 装配（evt 域 + cloud_health:service id） ============

describe('shouldReportCloudHealthSpike - Redis 路径（getRedis() 返回 fake client）', () => {
  it('incr 被调且 key 为 ep:prod:evt:cloud_health:tts（evt 域 + id 装配），count=1 → true 并种 1800s TTL', async () => {
    const client = createFakeClient()
    client.incr.mockResolvedValue(1)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(1800)
    mockGetRedis.mockReturnValue(client)
    const { shouldReportCloudHealthSpike } = await loadDedup()

    expect(await shouldReportCloudHealthSpike('tts')).toBe(true)

    expect(client.incr).toHaveBeenCalledTimes(1)
    expect(client.incr).toHaveBeenCalledWith('ep:prod:evt:cloud_health:tts')
    // 仅新窗口首计数（count===1）种 TTL，参数 = 窗口秒数 1800
    expect(client.expire).toHaveBeenCalledTimes(1)
    expect(client.expire).toHaveBeenCalledWith('ep:prod:evt:cloud_health:tts', 1800)
  })

  it('Redis 路径下同 service 二次（count=2）→ false', async () => {
    const client = createFakeClient()
    client.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    client.expire.mockResolvedValue(1)
    client.ttl.mockResolvedValue(1800)
    mockGetRedis.mockReturnValue(client)
    const { shouldReportCloudHealthSpike } = await loadDedup()

    expect(await shouldReportCloudHealthSpike('tts')).toBe(true)
    expect(await shouldReportCloudHealthSpike('tts')).toBe(false)
  })
})
