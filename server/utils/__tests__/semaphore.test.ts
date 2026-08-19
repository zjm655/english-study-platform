import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// semaphore（P4 D-P4-1）：serviceQueue 分布式信号量（Redis List + Lua 原子 acquire/release/renew）。
// mock 策略对齐 rateStore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回 fake
// client 或 null）+ vi.resetModules + 动态 import 重置模块态；logger mock 化以断言降级 warn。
// Redis 侧行为经 fake client.eval 模拟——(f) 用共享 fake eval 模拟多实例共享同一 Redis List。
// 覆盖：① 就绪客户端 acquire（断言 ACQUIRE Lua + key/参数 + 返回 token）② 全局满返回 null
// ③ 命令抛错 fail-open 返回 bypass ④ getRedis()=null / release(bypass) 不触 Redis
// ⑤ release 真实 token（断言 RELEASE Lua）⑥ 多实例共享 Redis 并发上限。

/** eval 选项形态（对齐 node-redis eval(script, { keys, arguments })） */
interface EvalOptions {
  keys: string[]
  arguments: string[]
}

interface FakeClient {
  eval: ReturnType<typeof vi.fn>
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
})

// 每次拿到干净的模块实例（信号量无模块态，重载仅为对齐 rateStore 先例并隔离 mock 状态）
async function loadStore() {
  return await import('../redis/semaphore')
}

/** fake Redis client：仅消费 eval 命令（可选自定义实现模拟 Redis 侧语义） */
function createFakeClient(
  evalImpl?: (script: string, options: EvalOptions) => unknown,
): FakeClient {
  return { eval: evalImpl ? vi.fn(evalImpl) : vi.fn() }
}

// ============ ① acquireSlot：就绪客户端成功路径 ============

describe('acquireSlot - 就绪客户端', () => {
  it('eval 收到 ACQUIRE Lua 与 key/参数，返回值等于捕获的 token', async () => {
    let capturedToken = ''
    // eval 实现返回 arguments[1]（token）模拟 Redis RPUSH 成功后回 token
    const client = createFakeClient((script, options) => {
      capturedToken = options.arguments[1]!
      return options.arguments[1]
    })
    mockGetRedis.mockReturnValue(client)
    const { acquireSlot, ACQUIRE_LUA } = await loadStore()

    const res = await acquireSlot('nls', 3, 300_000)

    expect(client.eval).toHaveBeenCalledTimes(1)
    expect(capturedToken).toBeTruthy()
    expect(client.eval).toHaveBeenCalledWith(ACQUIRE_LUA, {
      keys: ['ep:prod:sem:nls'],
      arguments: ['3', capturedToken, '300000'],
    })
    expect(res).toBe(capturedToken)
  })

  it('全局满：eval 返回 nil(null) → acquireSlot 返回 null（无名额，调用方轮询重试）', async () => {
    const client = createFakeClient(() => null)
    mockGetRedis.mockReturnValue(client)
    const { acquireSlot } = await loadStore()

    expect(await acquireSlot('nls', 2, 60_000)).toBeNull()
    expect(client.eval).toHaveBeenCalledTimes(1)
  })

  it('命令抛错 → fail-open 返回 SEMAPHORE_BYPASS_TOKEN + warn 留痕、不上抛', async () => {
    const client = createFakeClient(() => {
      throw new Error('CONNECTION RESET')
    })
    mockGetRedis.mockReturnValue(client)
    const { acquireSlot, SEMAPHORE_BYPASS_TOKEN } = await loadStore()

    const res = await acquireSlot('nls', 1, 60_000)
    expect(res).toBe(SEMAPHORE_BYPASS_TOKEN)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[semaphore]'))
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('CONNECTION RESET'))
  })
})

// ============ ④ getRedis()=null 与 bypass no-op ============

describe('Redis 不可用降级', () => {
  it('getRedis()=null → acquireSlot 返回 bypass token；release(bypass) 即使 Redis 就绪也不触 eval', async () => {
    mockGetRedis.mockReturnValue(null)
    const { acquireSlot, releaseSlot, SEMAPHORE_BYPASS_TOKEN } = await loadStore()
    expect(await acquireSlot('nls', 1, 60_000)).toBe(SEMAPHORE_BYPASS_TOKEN)

    // bypass token 直接 no-op：即便 Redis 就绪也不发 RELEASE 命令
    const client = createFakeClient(() => 1)
    mockGetRedis.mockReturnValue(client)
    await releaseSlot('nls', SEMAPHORE_BYPASS_TOKEN)
    expect(client.eval).not.toHaveBeenCalled()
  })
})

// ============ ⑤ releaseSlot 真实 token ============

describe('releaseSlot - 真实 token', () => {
  it('eval 收到 RELEASE Lua 与 token 参数', async () => {
    const client = createFakeClient(() => 1)
    mockGetRedis.mockReturnValue(client)
    const { releaseSlot, RELEASE_LUA } = await loadStore()

    await releaseSlot('nls', 'tok-123')

    expect(client.eval).toHaveBeenCalledTimes(1)
    expect(client.eval).toHaveBeenCalledWith(RELEASE_LUA, {
      keys: ['ep:prod:sem:nls'],
      arguments: ['tok-123'],
    })
  })
})

// ============ renewSlot：续租 ============

describe('renewSlot - 续租', () => {
  it('eval 收到 RENEW Lua 与租约参数', async () => {
    const client = createFakeClient(() => 1)
    mockGetRedis.mockReturnValue(client)
    const { renewSlot, RENEW_LUA } = await loadStore()

    await renewSlot('nls', 'tok-r', 60_000)

    expect(client.eval).toHaveBeenCalledTimes(1)
    expect(client.eval).toHaveBeenCalledWith(RENEW_LUA, {
      keys: ['ep:prod:sem:nls'],
      arguments: ['60000'],
    })
  })

  it('bypass token 不触 eval（no-op）', async () => {
    const client = createFakeClient(() => 1)
    mockGetRedis.mockReturnValue(client)
    const { renewSlot, SEMAPHORE_BYPASS_TOKEN } = await loadStore()

    await renewSlot('nls', SEMAPHORE_BYPASS_TOKEN, 60_000)
    expect(client.eval).not.toHaveBeenCalled()
  })
})

// ============ ⑥ 多实例共享 Redis：并发上限全局生效 ============

describe('多实例共享 Redis 并发上限', () => {
  it('A 占满 max → B 被拒（共享已满）→ A 释放后 B 成功', async () => {
    // 共享 fake eval：以模块级数组模拟 Redis List——含 LLEN 的 ACQUIRE（长度达上限返回
    // null，否则 push token 返回 token）/ 含 LREM 的 RELEASE（移除 token）。该数组即
    // 「共享 Redis 存储」，两个实例模块经同一 mockGetRedis/client 访问它。
    const sharedList: string[] = []
    const evalImpl = vi.fn(async (script: string, options: EvalOptions) => {
      // 先判 LREM（RELEASE_LUA 同时含 'LREM' 与 'LLEN'，必须优先），再判 LLEN（ACQUIRE_LUA）
      if (script.includes('LREM')) {
        const token = options.arguments[0]!
        const idx = sharedList.indexOf(token)
        if (idx >= 0) sharedList.splice(idx, 1)
        return 1
      }
      if (script.includes('LLEN')) {
        const max = Number(options.arguments[0])
        if (sharedList.length >= max) return null
        const token = options.arguments[1]!
        sharedList.push(token)
        return token
      }
      return 1
    })
    const client = createFakeClient(evalImpl)
    mockGetRedis.mockReturnValue(client)

    // 两次动态 import 模拟两个实例（共享同一 mockGetRedis → 同一共享 Redis List）
    const instanceA = await loadStore()
    const instanceB = await loadStore()

    // 实例 A 先占满 max=2
    const t1 = await instanceA.acquireSlot('nls', 2, 60_000)
    const t2 = await instanceA.acquireSlot('nls', 2, 60_000)
    expect(t1).not.toBeNull()
    expect(t2).not.toBeNull()
    // A 第 3 次 acquire 超限被拒
    expect(await instanceA.acquireSlot('nls', 2, 60_000)).toBeNull()
    // B acquire：共享已满，同样被拒（跨实例总并发受配置约束）
    expect(await instanceB.acquireSlot('nls', 2, 60_000)).toBeNull()

    // A 释放一个名额后 B 的 acquire 成功
    await instanceA.releaseSlot('nls', t1 as string)
    const tB = await instanceB.acquireSlot('nls', 2, 60_000)
    expect(tB).not.toBeNull()

    // 清理：B 释放自己占的名额，A 释放剩余名额 → 列表清空
    await instanceB.releaseSlot('nls', tB as string)
    expect(sharedList.length).toBe(1)
    await instanceA.releaseSlot('nls', t2 as string)
    expect(sharedList.length).toBe(0)
  })
})
