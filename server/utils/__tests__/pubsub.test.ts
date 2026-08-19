import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// pubsub（P4）：跨实例失效事件广播基建（publish / subscribe / buildChannel / 懒订阅）。
// mock 策略对齐 rateStore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回
// fake client 或 null）+ vi.mock logger + vi.resetModules + 动态 import 重置模块态
// （handlers Map / subClient 模块级状态）。pubsub 经动态 import redisConn，mockGetRedis
// 须在调用 publish/subscribe 前就位。
// 覆盖：① publish 就绪客户端 PUBLISH JSON ② getRedis()=null 静默 no-op
// ③ subscribe 注册 handler + 连接成功后收到 JSON 消息触发解析后回调
// ④ getRedis()=null 不抛错、不 duplicate。

/** fake 就绪主客户端（仅消费 duplicate） */
interface FakeMainClient {
  duplicate: ReturnType<typeof vi.fn>
}

/** fake 订阅客户端（仅消费 on/connect/subscribe） */
interface FakeSubClient {
  on: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
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
  // NODE_ENV=test → env 段固定 prod，通道名断言稳定
  vi.stubEnv('NODE_ENV', 'test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// 每次拿到干净模块态（handlers Map / subClient 均重置）
async function loadPubSub() {
  return await import('../redis/pubsub')
}

function createFakeMain(): FakeMainClient {
  return { duplicate: vi.fn() }
}

function createFakeSub(): FakeSubClient {
  return {
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
  }
}

// ============ ① publish：Redis 可用 → PUBLISH JSON ============

describe('publish - Redis 可用路径', () => {
  it('就绪客户端：调 client.publish(channel, JSON.stringify(payload))，不向调用方抛错', async () => {
    const client = { publish: vi.fn().mockResolvedValue(1) }
    mockGetRedis.mockReturnValue(client)
    const { publish } = await loadPubSub()

    await publish('ep:test:perm-invalidate', { userId: 1002 })

    expect(client.publish).toHaveBeenCalledTimes(1)
    expect(client.publish).toHaveBeenCalledWith(
      'ep:test:perm-invalidate',
      JSON.stringify({ userId: 1002 }),
    )
  })

  it('buildChannel 按 env 派生：NODE_ENV=development → dev 段；其余 → prod 段', async () => {
    const { buildChannel } = await loadPubSub()
    vi.stubEnv('NODE_ENV', 'development')
    expect(buildChannel('perm-invalidate')).toBe('ep:dev:perm-invalidate')
    vi.stubEnv('NODE_ENV', 'test')
    expect(buildChannel('perm-invalidate')).toBe('ep:prod:perm-invalidate')
  })
})

// ============ ② publish：getRedis()=null 静默 no-op ============

describe('publish - Redis 不可用（getRedis() 为 null）', () => {
  it('静默 no-op：不抛错、不产生任何命令调用', async () => {
    mockGetRedis.mockReturnValue(null)
    const { publish } = await loadPubSub()

    await expect(publish('ep:test:perm-invalidate', { userId: 1 })).resolves.toBeUndefined()
    expect(mockGetRedis).toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled() // 未配置属预期，不告警
  })
})

// ============ ③ subscribe：注册 handler + 连接成功后消息触发 ============

describe('subscribe - 注册与消息分发', () => {
  it('注册 handler；懒连接成功（duplicate+connect+subscribe）后，收到 JSON 消息 → 解析后触发 handler', async () => {
    const fakeSub = createFakeSub()
    const fakeMain = createFakeMain()
    fakeMain.duplicate.mockReturnValue(fakeSub)
    mockGetRedis.mockReturnValue(fakeMain)
    const { subscribe } = await loadPubSub()

    const handler = vi.fn()
    subscribe('ep:test:ch', handler)

    // 懒订阅：duplicate + connect + subscribe 各一次
    await vi.waitFor(() => expect(fakeSub.subscribe).toHaveBeenCalledTimes(1))
    expect(fakeMain.duplicate).toHaveBeenCalledTimes(1)
    expect(fakeSub.connect).toHaveBeenCalledTimes(1)
    expect(fakeSub.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(fakeSub.subscribe).toHaveBeenCalledWith(['ep:test:ch'], expect.any(Function))

    // 模拟 Redis 推送一条 JSON 消息：取出 subscribe 回调并调用
    const listener = fakeSub.subscribe.mock.calls[0]?.[1] as (
      message: string,
      channel: string,
    ) => void
    listener(JSON.stringify({ userId: 1002 }), 'ep:test:ch')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ userId: 1002 })
  })

  it('毒消息（非法 JSON）安全解析为 {}，不抛错、不打断其他 handler', async () => {
    const fakeSub = createFakeSub()
    const fakeMain = createFakeMain()
    fakeMain.duplicate.mockReturnValue(fakeSub)
    mockGetRedis.mockReturnValue(fakeMain)
    const { subscribe } = await loadPubSub()

    const handler = vi.fn()
    subscribe('ep:test:bad', handler)
    await vi.waitFor(() => expect(fakeSub.subscribe).toHaveBeenCalledTimes(1))
    const listener = fakeSub.subscribe.mock.calls[0]?.[1] as (
      message: string,
      channel: string,
    ) => void
    expect(() => listener('{broken json', 'ep:test:bad')).not.toThrow()
    expect(handler).toHaveBeenCalledWith({})
  })
})

// ============ ④ subscribe：getRedis()=null 不抛错、不 duplicate ============

describe('subscribe - Redis 不可用（getRedis() 为 null）', () => {
  it('handler 正常注册；不建订阅连接（duplicate 不被调用）、不抛错', async () => {
    const fakeMain = createFakeMain()
    mockGetRedis.mockReturnValue(null)
    const { subscribe } = await loadPubSub()

    expect(() => subscribe('ep:test:ch', vi.fn())).not.toThrow()
    // 等 ensureSubscriber 动态 import 链路跑完（走到 getRedis 即被 null 挡回）
    await vi.waitFor(() => expect(mockGetRedis).toHaveBeenCalled())
    expect(fakeMain.duplicate).not.toHaveBeenCalled()
  })
})
