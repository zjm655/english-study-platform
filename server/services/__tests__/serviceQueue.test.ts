import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  withQueue,
  getQueueStats,
  syncServiceQueueConcurrency,
  __forceEnableForTest,
} from '../serviceQueue'

// ===== serviceQueue 测试 =====
// 覆盖：VITEST 默认直通 / 并发上限 / 0=直通 / priority / signal 取消 / 配置热更

// 配置读取已接入 configStore（模块内不再自建缓存）：mock getSysConfigKeys 返回固定 Map，
// 每次 withQueue 均重新读取，热更语义 = 改 mock 返回值后下次入队拿到新值
const { mockGetSysConfigKeys, mockGetRedis, mockRenewSlot } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
  mockGetRedis: vi.fn(),
  mockRenewSlot: vi.fn(async () => {}),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))
vi.mock('#server/utils/fileLogger', () => ({ fileLog: vi.fn(), fileLogError: vi.fn() }))
// Redis 不可用 → acquireSlot 返回 bypass token，本文件测试专注本地 p-queue 语义，
// 全局信号量行为在 server/utils/__tests__/semaphore.test.ts 单独覆盖
vi.mock('#server/utils/redisConn', () => ({ getRedis: mockGetRedis }))
// 续租走真实 semaphore 的 acquire/release，但 renewSlot 打点以便断言接线正确
vi.mock('#server/utils/redis/semaphore', async (importOriginal) => {
  const mod = await importOriginal<typeof import('#server/utils/redis/semaphore')>()
  return { ...mod, renewSlot: mockRenewSlot }
})

/** 配置 mock：返回各队列并发数（未列出的队列 = 缺键 = 0 = 不限流） */
function setConcurrency(values: Record<string, number>) {
  mockGetSysConfigKeys.mockResolvedValue(
    new Map(Object.entries(values).map(([name, n]) => [`queue_${name}_concurrency`, String(n)])),
  )
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

beforeEach(() => {
  vi.clearAllMocks()
  // Redis 视为不可用：acquireSlot 返回 bypass token，全局闸门旁路
  mockGetRedis.mockReturnValue(null)
  // 兜底：即便 vitest 偶发经未 mock 路径加载真实 db/redisConn 链路，顶层 useRuntimeConfig
  // （node 环境未定义）也不再崩溃（redisConn.test.ts 同款 stubGlobal 先例）
  vi.stubGlobal('useRuntimeConfig', () => ({ db: {}, redis: {} }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  __forceEnableForTest(false)
})

describe('withQueue', () => {
  it('VITEST 环境默认直通（不加载配置、不排队）', async () => {
    const result = await withQueue('tts', async () => 'ok')
    expect(result).toBe('ok')
    expect(mockGetSysConfigKeys).not.toHaveBeenCalled()
  })

  it('并发配置为 0 时直通执行', async () => {
    __forceEnableForTest(true)
    setConcurrency({ tts: 0 })
    let running = 0
    let maxRunning = 0
    const task = async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await sleep(20)
      running--
    }
    await Promise.all([withQueue('tts', task), withQueue('tts', task), withQueue('tts', task)])
    expect(maxRunning).toBe(3) // 不限流：全部并行
  })

  it('并发上限生效：同时运行数不超过配置值', async () => {
    __forceEnableForTest(true)
    setConcurrency({ nls: 2 })
    let running = 0
    let maxRunning = 0
    const task = async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await sleep(30)
      running--
      return running
    }
    await Promise.all(Array.from({ length: 5 }, () => withQueue('nls', task)))
    expect(maxRunning).toBeLessThanOrEqual(2)
  })

  it('priority：高优先级任务先于低优先级执行', async () => {
    __forceEnableForTest(true)
    setConcurrency({ deepseek: 1 })
    const order: string[] = []
    // 先占住唯一名额
    const blocker = withQueue('deepseek', async () => {
      await sleep(40)
      order.push('blocker')
    })
    await sleep(10) // 确保 blocker 已开始执行
    const low = withQueue(
      'deepseek',
      async () => {
        order.push('low')
      },
      { priority: 0 },
    )
    const high = withQueue(
      'deepseek',
      async () => {
        order.push('high')
      },
      { priority: 1 },
    )
    await Promise.all([blocker, low, high])
    expect(order).toEqual(['blocker', 'high', 'low'])
  })

  it('signal：排队中的任务可被取消（不执行且 reject）', async () => {
    __forceEnableForTest(true)
    setConcurrency({ upload: 1 })
    const executed = vi.fn()
    const blocker = withQueue('upload', () => sleep(60))
    await sleep(10)
    const controller = new AbortController()
    const cancelled = withQueue('upload', async () => executed(), {
      signal: controller.signal,
    })
    controller.abort()
    await expect(cancelled).rejects.toThrow()
    await blocker
    expect(executed).not.toHaveBeenCalled()
  })

  it('配置热更：读到新值后下次入队热更 concurrency', async () => {
    __forceEnableForTest(true)
    setConcurrency({ tts: 1 })
    await withQueue('tts', async () => 'warm') // 触发首次配置读取并热更
    expect(getQueueStats().find((s) => s.name === 'tts')?.concurrency).toBe(1)

    setConcurrency({ tts: 5 }) // 管理端改配置（configStore 缓存已失效/到期）
    await withQueue('tts', async () => 'reload')
    expect(getQueueStats().find((s) => s.name === 'tts')?.concurrency).toBe(5)
  })

  it('配置读取失败时按不限流处理（不阻塞业务）', async () => {
    __forceEnableForTest(true)
    mockGetSysConfigKeys.mockRejectedValue(new Error('db down'))
    const result = await withQueue('tts', async () => 'still-works')
    expect(result).toBe('still-works')
  })

  it('长任务执行期间周期性调用 renewSlot 续租（租约不被回收）', async () => {
    __forceEnableForTest(true)
    setConcurrency({ upload: 1 })
    vi.useFakeTimers()
    try {
      let finished = false
      const task = async () => {
        // 模拟超过 5min 租约的长任务；用 fake timers 跳过真实等待
        await new Promise<void>((r) => setTimeout(r, 10 * 60 * 1000))
        finished = true
      }
      const running = withQueue('upload', task)

      // 任务已开始执行（acquireSlot 已拿名额）——此时应已排定续租定时器
      await vi.advanceTimersByTimeAsync(0)
      expect(mockRenewSlot).not.toHaveBeenCalled()

      // 推进超过续租间隔（60s）→ 应调用 renewSlot
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockRenewSlot).toHaveBeenCalledTimes(1)
      expect(mockRenewSlot).toHaveBeenCalledWith('upload', expect.any(String), expect.any(Number))

      // 再推进一个周期 → 继续续租
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockRenewSlot).toHaveBeenCalledTimes(2)

      // 任务最终完成 → releaseSlot 释放、定时器清理（不再续租）
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await running
      expect(finished).toBe(true)
      const callsAfterFinish = mockRenewSlot.mock.calls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(mockRenewSlot.mock.calls.length).toBe(callsAfterFinish)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('getQueueStats', () => {
  it('返回全部四个队列的水位快照', () => {
    const stats = getQueueStats()
    expect(stats.map((s) => s.name).sort()).toEqual(['deepseek', 'nls', 'tts', 'upload'])
    for (const s of stats) {
      expect(s).toHaveProperty('concurrency')
      expect(s).toHaveProperty('size')
      expect(s).toHaveProperty('pending')
    }
  })

  it('冷启动未发生云调用时 syncServiceQueueConcurrency 把配置热更到队列实例（监控不误报不限流）', async () => {
    __forceEnableForTest(true)
    setConcurrency({ tts: 4, nls: 2 })
    // 未调 withQueue，直接同步配置
    await syncServiceQueueConcurrency()
    const stats = getQueueStats()
    expect(stats.find((s) => s.name === 'tts')?.concurrency).toBe(4)
    expect(stats.find((s) => s.name === 'nls')?.concurrency).toBe(2)
  })
})
