import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// redisConn（P0，D5/D17）：懒初始化单例 + 优雅降级。
// CI 无真实 Redis：mock `redis` 包 createClient，fake client 用 EventEmitter 模拟
// connect/ready/error/end；模块级单例状态在用例间通过 vi.resetModules() + 动态 import 重置
//（参考 rateLimiter.test.ts 对模块态的处理方式）。

const { mockCreateClient, mockLogAlertEvent, mockLogger } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockLogAlertEvent: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('redis', () => ({ createClient: mockCreateClient }))
vi.mock('../alertEventLog', () => ({ logAlertEvent: mockLogAlertEvent }))
vi.mock('#shared/utils/logger', () => ({ logger: mockLogger }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// 每次拿到带干净模块级单例的实例（懒初始化，runtimeConfig 首次调用时读取）
async function loadConn() {
  return await import('../redisConn')
}

/** stub useRuntimeConfig().redis（默认未配置，可覆盖三项） */
function stubRedisConfig(cfg: { host?: string; port?: string; password?: string } = {}) {
  vi.stubGlobal('useRuntimeConfig', () => ({
    redis: { host: '', port: '', password: '', ...cfg },
  }))
}

/** fake RedisClient：EventEmitter + connect/disconnect + isReady 受控开关 */
function createFakeClient(connectError?: Error) {
  const client = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    isReady: boolean
  }
  let ready = false
  Object.defineProperty(client, 'isReady', {
    get: () => ready,
    configurable: true,
  })
  client.connect = connectError
    ? vi.fn(() => Promise.reject(connectError))
    : vi.fn(() => {
        ready = true
        return Promise.resolve()
      })
  client.disconnect = vi.fn(() => {
    ready = false
    return Promise.resolve()
  })
  const setReady = (v: boolean) => {
    ready = v
  }
  return { client, setReady }
}

/** 汇总所有日志/告警调用的文本，用于断言密码不外泄 */
function allLoggedText(): string {
  const loggerCalls = Object.values(mockLogger).flatMap((fn) => fn.mock.calls)
  return JSON.stringify([mockLogAlertEvent.mock.calls, loggerCalls])
}

// ============ 场景 a：未配置（host 为空） ============

describe('redisConn - 未配置', () => {
  it('getRedis() 返回 null、不调 createClient、一条 redis_unconfigured 告警且不刷屏', async () => {
    stubRedisConfig({ host: '' })
    const { getRedis } = await loadConn()

    expect(getRedis()).toBeNull()
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
    expect(mockLogAlertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'redis_health', code: 'redis_unconfigured' }),
    )

    // 重复调用不再写告警
    expect(getRedis()).toBeNull()
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
  })
})

// ============ 场景 b：已配置且连接成功 ============

describe('redisConn - 连接成功', () => {
  it('connect 成功后 getRedis() 返回客户端单例，正常路径无告警', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6379', password: 'unit-test-pass' })
    const { client: fake } = createFakeClient()
    mockCreateClient.mockReturnValue(fake)
    const { getRedis } = await loadConn()

    getRedis() // 触发懒初始化（fire-and-forget 连接）
    await vi.waitFor(() => expect(getRedis()).toBe(fake))
    expect(mockLogAlertEvent).not.toHaveBeenCalled()
  })
})

// ============ 场景 c：已配置但连接失败 ============

describe('redisConn - 连接失败', () => {
  it('connect 拒绝 → 一条 redis_unavailable 告警，getRedis() 返回 null（不等待重连）', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6379' })
    const { client: fake } = createFakeClient(new Error('connect ECONNREFUSED 127.0.0.1:6379'))
    mockCreateClient.mockReturnValue(fake)
    const { getRedis } = await loadConn()

    getRedis()
    await vi.waitFor(() =>
      expect(mockLogAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'redis_health', code: 'redis_unavailable' }),
      ),
    )
    // 快速失败：不等待重连，立即 null
    expect(getRedis()).toBeNull()
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
  })
})

// ============ 场景 d：运行中断连 → 恢复 ============

describe('redisConn - 断连与恢复', () => {
  it('error 降级告警一次、重复 error 不刷屏、ready 恢复告警一次、再次断连重新告警', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6379' })
    const { client: fake, setReady } = createFakeClient()
    mockCreateClient.mockReturnValue(fake)
    const { getRedis } = await loadConn()

    // 先连接成功
    getRedis()
    await vi.waitFor(() => expect(getRedis()).toBe(fake))
    expect(mockLogAlertEvent).not.toHaveBeenCalled()

    // 断连：降级 + 一条 unavailable
    setReady(false)
    fake.emit('error', new Error('Socket closed'))
    expect(getRedis()).toBeNull()
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
    expect(mockLogAlertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'redis_health', code: 'redis_unavailable' }),
    )

    // 重复 error 不刷屏
    fake.emit('error', new Error('Socket closed again'))
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)

    // end 事件同样不刷屏（仍处于降级态）
    fake.emit('end')
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)

    // 恢复：自动切回 + 一条 recovered
    setReady(true)
    fake.emit('ready')
    expect(getRedis()).toBe(fake)
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(2)
    expect(mockLogAlertEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: 'redis_health', code: 'redis_recovered' }),
    )

    // 再断连：新跃迁 → 再一条 unavailable
    setReady(false)
    fake.emit('error', new Error('Socket closed'))
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(3)
  })
})

// ============ 场景 e：ifAvailable ============

describe('redisConn - ifAvailable', () => {
  it('不可用直接返回 null，不执行 fn', async () => {
    stubRedisConfig({ host: '' })
    const { ifAvailable } = await loadConn()
    const fn = vi.fn(async () => 'result')

    expect(await ifAvailable(fn)).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('可用时执行 fn 并返回其结果；fn 抛错返回 null 不上抛', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6379' })
    const { client: fake } = createFakeClient()
    mockCreateClient.mockReturnValue(fake)
    const { getRedis, ifAvailable } = await loadConn()

    getRedis()
    await vi.waitFor(() => expect(getRedis()).toBe(fake))

    expect(await ifAvailable(async (c) => c)).toBe(fake)
    expect(
      await ifAvailable(async () => {
        throw new Error('WRONGTYPE Operation')
      }),
    ).toBeNull()
  })
})

// ============ 场景 f：createClient 参数与密码安全 ============

describe('redisConn - createClient 参数', () => {
  it('对象式连接：socket{host,port,connectTimeout:2000,reconnectStrategy} + password（非 URL 字符串）', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6380', password: 's3cret-p@ss:' })
    const { client: fake } = createFakeClient()
    mockCreateClient.mockReturnValue(fake)
    const { getRedis } = await loadConn()

    getRedis()
    await vi.waitFor(() => expect(getRedis()).toBe(fake))

    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockCreateClient).toHaveBeenCalledWith({
      socket: {
        host: '127.0.0.1',
        port: 6380,
        connectTimeout: 2000,
        reconnectStrategy: expect.any(Function),
      },
      password: 's3cret-p@ss:',
    })
  })

  it('reconnectStrategy 指数退避：500ms 起步 ×2 递增、封顶 30s 持续重试', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6379' })
    const { client: fake } = createFakeClient()
    mockCreateClient.mockReturnValue(fake)
    const { getRedis } = await loadConn()

    getRedis()
    await vi.waitFor(() => expect(getRedis()).toBe(fake))

    const strategy = mockCreateClient.mock.calls[0]?.[0]?.socket?.reconnectStrategy as (
      retries: number,
    ) => number
    expect(strategy(0)).toBe(500)
    expect(strategy(1)).toBe(1000)
    expect(strategy(3)).toBe(4000)
    expect(strategy(7)).toBe(30_000) // 500×2^7=64000 → 封顶
    expect(strategy(20)).toBe(30_000)
  })

  it('密码绝不出现于任何日志/告警消息（含断连告警路径）', async () => {
    stubRedisConfig({ host: '127.0.0.1', port: '6379', password: 's3cret-p@ss:' })
    const { client: fake, setReady } = createFakeClient()
    mockCreateClient.mockReturnValue(fake)
    const { getRedis } = await loadConn()

    getRedis()
    await vi.waitFor(() => expect(getRedis()).toBe(fake))

    // 触发告警路径（连接失败告警 + 恢复告警）后统一检查
    setReady(false)
    fake.emit('error', new Error('Connection lost'))
    setReady(true)
    fake.emit('ready')
    expect(mockLogAlertEvent.mock.calls.length).toBeGreaterThan(0)

    expect(allLoggedText()).not.toContain('s3cret-p@ss:')
  })
})
