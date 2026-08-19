import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// clusterLock（P4 缺口 #2）：后台插件定时器分布式锁（SET NX PX + 持有者令牌 + compare-and-delete）。
// mock 策略对齐 rateStore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回 fake client
// 或 null）；vi.resetModules + 动态 import 重置模块态（instanceId 进程级随机，仅断言 del 参数即可）；
// logger mock 化以便断言 fail-open 的 warn 留痕。fake client 仅 set/get/del 三命令。

interface FakeClient {
  set: ReturnType<typeof vi.fn>
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

// 每次拿到带干净模块态（instanceId 重新随机）的实例
async function loadLock() {
  return await import('../redis/clusterLock')
}

/** fake RedisClient：仅 clusterLock 消费的三个命令 */
function createFakeClient(): FakeClient {
  return { set: vi.fn(), get: vi.fn(), del: vi.fn() }
}

// ============ ① 获取成功：task 执行 + compare-and-delete ============

describe('withClusterLock - Redis 路径获取成功', () => {
  it('set 返回 OK → task 执行、返回 true；task 完成后 get 命中本实例令牌 → del 被调用且参数为 key', async () => {
    const client = createFakeClient()
    client.set.mockResolvedValue('OK')
    // get 返回 set 写入的持有者令牌（模拟锁仍属本实例）
    client.get.mockImplementation(() =>
      Promise.resolve((client.set.mock.calls[0]?.[1] as string | undefined) ?? null),
    )
    const task = vi.fn().mockResolvedValue(undefined)
    mockGetRedis.mockReturnValue(client)
    const { withClusterLock } = await loadLock()

    const result = await withClusterLock('guest-cleanup', task)

    expect(result).toBe(true)
    expect(task).toHaveBeenCalledTimes(1)
    const key = 'ep:prod:lock:guest-cleanup'
    expect(client.set).toHaveBeenCalledTimes(1)
    expect(client.set).toHaveBeenCalledWith(key, expect.any(String), { NX: true, PX: 600000 })
    // compare-and-delete：get 先校验锁仍属本实例，再 del（参数为 key）
    expect(client.get).toHaveBeenCalledWith(key)
    expect(client.del).toHaveBeenCalledWith(key)
  })
})

// ============ ② 锁被占用：跳过本轮 ============

describe('withClusterLock - 锁被占用', () => {
  it('set 返回 null → task 不执行、返回 false、get/del 均不被调用', async () => {
    const client = createFakeClient()
    client.set.mockResolvedValue(null)
    const task = vi.fn()
    mockGetRedis.mockReturnValue(client)
    const { withClusterLock } = await loadLock()

    const result = await withClusterLock('log-archive', task)

    expect(result).toBe(false)
    expect(task).not.toHaveBeenCalled()
    expect(client.set).toHaveBeenCalledTimes(1)
    expect(client.set).toHaveBeenCalledWith('ep:prod:lock:log-archive', expect.any(String), {
      NX: true,
      PX: 600000,
    })
    expect(client.get).not.toHaveBeenCalled()
    expect(client.del).not.toHaveBeenCalled()
  })
})

// ============ ③ compare-and-delete 防误删他人锁 ============

describe('withClusterLock - compare-and-delete 防误删', () => {
  it('task 执行期间锁过期被他人持有（get 返回其他值）→ del 不被调用', async () => {
    const client = createFakeClient()
    client.set.mockResolvedValue('OK')
    // 锁已不属于本实例（他人实例令牌）
    client.get.mockResolvedValue('other-instance')
    const task = vi.fn().mockResolvedValue(undefined)
    mockGetRedis.mockReturnValue(client)
    const { withClusterLock } = await loadLock()

    const result = await withClusterLock('orphan-audio', task)

    expect(result).toBe(true)
    expect(task).toHaveBeenCalledTimes(1)
    expect(client.get).toHaveBeenCalledWith('ep:prod:lock:orphan-audio')
    expect(client.del).not.toHaveBeenCalled()
  })
})

// ============ ④ Redis 不可用：直跑 ============

describe('withClusterLock - Redis 不可用（getRedis()=null）', () => {
  it('getRedis() 返回 null → task 直跑、返回 true、不触碰任何 Redis 命令', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(null)
    const task = vi.fn().mockResolvedValue(undefined)
    const { withClusterLock } = await loadLock()

    const result = await withClusterLock('cloud-health', task)

    expect(result).toBe(true)
    expect(task).toHaveBeenCalledTimes(1)
    // 未建连 → set/get/del 均不可能被调用
    expect(client.set).not.toHaveBeenCalled()
    expect(client.get).not.toHaveBeenCalled()
    expect(client.del).not.toHaveBeenCalled()
  })
})

// ============ ⑤ 加锁命令异常：fail-open 直跑 ============

describe('withClusterLock - 加锁命令异常 fail-open', () => {
  it('set 抛错 → task 直跑、返回 true、get/del 不被调用、warn 留痕', async () => {
    const client = createFakeClient()
    client.set.mockRejectedValue(new Error('CONNECTION RESET'))
    const task = vi.fn().mockResolvedValue(undefined)
    mockGetRedis.mockReturnValue(client)
    const { withClusterLock } = await loadLock()

    const result = await withClusterLock('file-log-cleanup', task)

    expect(result).toBe(true)
    expect(task).toHaveBeenCalledTimes(1)
    expect(client.get).not.toHaveBeenCalled()
    expect(client.del).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[cluster lock:file-log-cleanup]'),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('CONNECTION RESET'))
  })
})
