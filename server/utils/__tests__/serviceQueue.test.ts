import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  withQueue,
  getQueueStats,
  invalidateServiceQueueCache,
  syncServiceQueueConcurrency,
  __forceEnableForTest,
} from '../serviceQueue'

// ===== serviceQueue 测试 =====
// 覆盖：VITEST 默认直通 / 并发上限 / 0=直通 / priority / signal 取消 / 配置热更

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('../fileLogger', () => ({ fileLog: vi.fn(), fileLogError: vi.fn() }))

/** 配置 mock：返回各队列并发数 */
function setConcurrency(values: Record<string, number>) {
  mockQuery.mockResolvedValue(
    Object.entries(values).map(([name, n]) => ({
      config_key: `queue_${name}_concurrency`,
      config_value: String(n),
    })),
  )
  invalidateServiceQueueCache()
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

beforeEach(() => {
  vi.clearAllMocks()
  invalidateServiceQueueCache()
})

afterEach(() => {
  __forceEnableForTest(false)
})

describe('withQueue', () => {
  it('VITEST 环境默认直通（不加载配置、不排队）', async () => {
    const result = await withQueue('tts', async () => 'ok')
    expect(result).toBe('ok')
    expect(mockQuery).not.toHaveBeenCalled()
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

  it('配置热更：invalidate 后下次入队读新值并更新 concurrency', async () => {
    __forceEnableForTest(true)
    setConcurrency({ tts: 1 })
    await withQueue('tts', async () => 'warm') // 触发首次配置加载
    expect(getQueueStats().find((s) => s.name === 'tts')?.concurrency).toBe(1)

    setConcurrency({ tts: 5 }) // 内含 invalidate
    await withQueue('tts', async () => 'reload')
    expect(getQueueStats().find((s) => s.name === 'tts')?.concurrency).toBe(5)
  })

  it('配置查询失败时按不限流处理（不阻塞业务）', async () => {
    __forceEnableForTest(true)
    mockQuery.mockRejectedValue(new Error('db down'))
    invalidateServiceQueueCache()
    const result = await withQueue('tts', async () => 'still-works')
    expect(result).toBe('still-works')
  })

  it('刷新在途时 invalidate：在途结果不写缓存，下次入队重新查库', async () => {
    __forceEnableForTest(true)
    // 第一次查询挂起，期间发生 invalidate（模拟管理端刚改完配置）
    let resolveFirst!: (rows: unknown) => void
    mockQuery.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    invalidateServiceQueueCache()

    const first = withQueue('tts', async () => 'first')
    await sleep(10) // 确保在途刷新已发起
    invalidateServiceQueueCache() // 管理端 PUT 新配置
    resolveFirst([{ config_key: 'queue_tts_concurrency', config_value: '1' }]) // 旧配置返回
    await first

    // 旧结果不得写缓存：下次入队必须重新查库（拿到新配置 5）
    mockQuery.mockResolvedValue([{ config_key: 'queue_tts_concurrency', config_value: '5' }])
    await withQueue('tts', async () => 'second')
    expect(getQueueStats().find((s) => s.name === 'tts')?.concurrency).toBe(5)
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
