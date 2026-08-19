import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { QueueStoreOptions } from '../queueStore'

// queueStore（P3，D-P3-3/D-P3-5）：埋点队列双 Adapter 基建（Redis STREAM + 内存降级）。
// mock 策略对齐 configStore.test.ts 先例：vi.hoisted + vi.mock（动态 import 同样被 vi.mock
// 拦截，参考 serviceQueue.test.ts 动态 import configStore 的 mock 先例）+ vi.resetModules +
// 动态 import 重置模块态（内存数组 / redisConn 动态加载缓存）；mock '#server/utils/db'
// （INSERT 落库）与 redisConn 连接层——getRedis() 返回 fake client（Redis 路径）或 null
// （内存 Adapter 走真逻辑）；logger mock 以断言失败/降级留痕。
// fake timers 默认开启：消费 timer 于 createQueue 即注册（unref），fake 下不推进则永不触发，
// 隔离「阈值立即 flush / flushAll / advanceTimersByTimeAsync(5000)」三类受控触发。

/** 测试用条目类型 */
interface Entry {
  id: number
  tag: string
}

const { mockQuery, mockGetRedis, mockLogger } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetRedis: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/redisConn', () => ({ getRedis: mockGetRedis }))
vi.mock('../../../shared/utils/logger', () => ({ logger: mockLogger }))

/** fake Redis client：仅 queueStore 消费的五个 stream 命令 */
function createFakeClient() {
  return {
    xAdd: vi.fn().mockResolvedValue('1-1'),
    xGroupCreate: vi.fn().mockResolvedValue('OK'),
    xReadGroup: vi.fn().mockResolvedValue(null),
    xAck: vi.fn().mockResolvedValue(1),
    xDel: vi.fn().mockResolvedValue(1),
  }
}

/** xReadGroup 回复形态（经 node-redis 默认 TypeMapping 变换后：message 为普通对象） */
interface FakeStreamMessage {
  id: string
  message: { p: string }
}

function streamReply(key: string, messages: FakeStreamMessage[]) {
  return [{ name: key, messages }]
}

function msg(id: string, entry: Entry): FakeStreamMessage {
  return { id, message: { p: JSON.stringify(entry) } }
}

/** 消费方形态参考 apiCallLog：buildSql 返回可断言的扁平 params */
function buildSqlFor(entries: Entry[]): { sql: string; params: unknown[] } {
  return {
    sql: `INSERT INTO test_log (id, tag) VALUES ${entries.map(() => '(?, ?)').join(', ')}`,
    params: entries.flatMap((e) => [e.id, e.tag]),
  }
}

const NS = 'api_call_log'
const KEY = 'ep:prod:q:api_call_log'
const XADD_TRIM = { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 } }

/** 默认内存路径 + 大 batchSize（避免阈值立即 flush 干扰累积断言） */
function memoryOptions(
  overrides: Partial<QueueStoreOptions<Entry>> = {},
): QueueStoreOptions<Entry> {
  return { namespace: NS, batchSize: 100, buildSql: buildSqlFor, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('NODE_ENV', 'test') // env 段固定 prod → key 断言稳定
  mockGetRedis.mockReturnValue(null) // 默认内存路径
  mockQuery.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function loadStore() {
  return await import('../queueStore')
}

// ============ ① 内存 Adapter（getRedis()=null）============

describe('内存 Adapter - push 累积与 flushAll drain', () => {
  it('push 累积内存数组不写库；flushAll 全量 drain 单批 INSERT；getStats 内存语义', async () => {
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions())
    q.push({ id: 1, tag: 'a' })
    q.push({ id: 2, tag: 'b' })
    q.push({ id: 3, tag: 'c' })
    expect(mockQuery).not.toHaveBeenCalled()
    expect(q.getStats()).toEqual({ size: 3, maxSize: 10_000, dropped: 0 })

    await q.flushAll()

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO test_log')
    expect(params).toEqual([1, 'a', 2, 'b', 3, 'c'])
    expect(q.getStats().size).toBe(0)
  })

  it('达 batchSize 阈值时立即 flush 一次（batchQueue 现状语义，勿回归）', async () => {
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions({ batchSize: 2 }))
    q.push({ id: 1, tag: 'a' })
    expect(mockQuery).not.toHaveBeenCalled()
    q.push({ id: 2, tag: 'b' })
    // 阈值 flush 在 push 内同步执行至 query 调用
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const params = mockQuery.mock.calls[0]?.[1]
    expect(params).toEqual([1, 'a', 2, 'b'])
    expect(q.getStats().size).toBe(0)
  })

  it('软上限丢最旧 + onDrop 回调节流（首次 + 每 1000 条）', async () => {
    const onDrop = vi.fn()
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions({ maxQueueSize: 3, onDrop }))
    // 填满 3 条
    q.push({ id: 1, tag: 't1' })
    q.push({ id: 2, tag: 't2' })
    q.push({ id: 3, tag: 't3' })
    expect(onDrop).not.toHaveBeenCalled()
    // 第 4 条触发丢最旧（id=1）
    q.push({ id: 4, tag: 't4' })
    expect(q.getStats()).toEqual({ size: 3, maxSize: 3, dropped: 1 })
    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledWith(1)
    // 继续推到累计丢弃 1000（共 1003 次 push）：节流只在 dropped=1000 再报一次
    for (let i = 5; i <= 1003; i++) q.push({ id: i, tag: `t${i}` })
    expect(q.getStats().dropped).toBe(1000)
    expect(onDrop).toHaveBeenCalledTimes(2)
    expect(onDrop).toHaveBeenLastCalledWith(1000)
    // 丢最旧语义：flushAll 后仅剩最后 3 条落库
    await q.flushAll()
    const params = mockQuery.mock.calls[0]?.[1]
    expect(params).toEqual([1001, 't1001', 1002, 't1002', 1003, 't1003'])
  })

  it('INSERT 失败静默丢批不重试（旁路原则）+ logger.error 留痕，不阻塞后续写入', async () => {
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions({ errorLabel: '[test queue] 写入失败:' }))
    q.push({ id: 1, tag: 'a' })
    q.push({ id: 2, tag: 'b' })
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await expect(q.flushAll()).resolves.toBeUndefined()
    expect(mockLogger.error).toHaveBeenCalledWith('[test queue] 写入失败:', expect.any(Error))
    expect(q.getStats().size).toBe(0) // 失败批已丢弃
    // 后续批次正常写入
    q.push({ id: 3, tag: 'c' })
    await q.flushAll()
    expect(mockQuery).toHaveBeenCalledTimes(2)
    const params = mockQuery.mock.calls[1]?.[1]
    expect(params).toEqual([3, 'c'])
  })
})

// ============ ② Redis 路径 push → XADD ============

describe('Redis 路径 - push 经 XADD 写入 stream', () => {
  it('key=redisKey("q", ns)、id=*、payload 单字段 p=JSON、MAXLEN ~10000 兜底裁剪；内存不承接', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions())
    // 先走一个 timer tick：完成 redisConn 动态加载（warm），push 才会走 XADD 路径
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockGetRedis).toHaveBeenCalled() // warm 证明（tick 消费已启动）

    q.push({ id: 1, tag: 'a' })
    await vi.waitFor(() => expect(client.xAdd).toHaveBeenCalledTimes(1))

    expect(client.xAdd).toHaveBeenCalledWith(
      KEY,
      '*',
      { p: JSON.stringify({ id: 1, tag: 'a' }) },
      XADD_TRIM,
    )
    expect(q.getStats().size).toBe(0) // Redis 承接，内存不积压
    expect(mockQuery).not.toHaveBeenCalled() // 未消费不落库
  })

  it('enrich 在 XADD 前执行（payload 含补充字段）', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    const { createQueue } = await loadStore()
    const q = createQueue(
      memoryOptions({
        enrich: (e) => {
          e.tag = `enriched:${e.tag}`
        },
      }),
    )
    await vi.advanceTimersByTimeAsync(5000)

    q.push({ id: 1, tag: 'a' })
    await vi.waitFor(() => expect(client.xAdd).toHaveBeenCalledTimes(1))

    expect(client.xAdd).toHaveBeenCalledWith(
      KEY,
      '*',
      { p: JSON.stringify({ id: 1, tag: 'enriched:a' }) },
      XADD_TRIM,
    )
  })
})

// ============ ③ 消费编排（timer 驱动，每 5s 一轮）============

describe('Redis 消费编排 - XGROUP/XREADGROUP/INSERT/XACK/XDEL', () => {
  it('完整编排 + 重启恢复：XGROUP 幂等初始化 → 先 pending("0") 后新(">") 各 COUNT batchSize → INSERT → 逐条 XACK+XDEL', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    const { createQueue } = await loadStore()
    // "0" 读返回一条 pending（模拟重启恢复：上轮消费前崩溃的存量）；">" 读返回一条新消息
    client.xReadGroup
      .mockResolvedValueOnce(streamReply(KEY, [msg('1-1', { id: 1, tag: 'a' })]))
      .mockResolvedValueOnce(streamReply(KEY, [msg('2-1', { id: 2, tag: 'b' })]))
    createQueue(memoryOptions({ batchSize: 50 }))
    await vi.advanceTimersByTimeAsync(5000)

    // 消费组幂等初始化（cg-writer + MKSTREAM）
    expect(client.xGroupCreate).toHaveBeenCalledWith(KEY, 'cg-writer', '$', { MKSTREAM: true })
    // 先 "0"（自己 pending，重启恢复）后 ">"（新消息），消费者名 w1，各 COUNT batchSize
    expect(client.xReadGroup).toHaveBeenNthCalledWith(
      1,
      'cg-writer',
      'w1',
      [{ key: KEY, id: '0' }],
      { COUNT: 50 },
    )
    expect(client.xReadGroup).toHaveBeenNthCalledWith(
      2,
      'cg-writer',
      'w1',
      [{ key: KEY, id: '>' }],
      { COUNT: 50 },
    )
    // 两条各成一批 INSERT（pending 批 + 新消息批）
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([1, 'a'])
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([2, 'b'])
    // 逐条 XACK+XDEL（无论来源批次）
    expect(client.xAck).toHaveBeenCalledWith(KEY, 'cg-writer', '1-1')
    expect(client.xDel).toHaveBeenCalledWith(KEY, '1-1')
    expect(client.xAck).toHaveBeenCalledWith(KEY, 'cg-writer', '2-1')
    expect(client.xDel).toHaveBeenCalledWith(KEY, '2-1')
  })

  it('XGROUP CREATE 报 BUSYGROUP（消费组已存在）→ catch 忽略不抛错，消费照常进行', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    client.xGroupCreate.mockRejectedValueOnce(
      new Error('BUSYGROUP Consumer Group name already exists'),
    )
    client.xReadGroup
      .mockResolvedValueOnce(streamReply(KEY, [msg('1-1', { id: 1, tag: 'a' })]))
      .mockResolvedValue(null)
    const { createQueue } = await loadStore()
    createQueue(memoryOptions())
    await vi.advanceTimersByTimeAsync(5000)

    expect(client.xReadGroup).toHaveBeenCalledTimes(2) // 消费未被中断
    expect(mockLogger.warn).not.toHaveBeenCalled() // BUSYGROUP 是幂等预期，不算错误
    expect(client.xAck).toHaveBeenCalledWith(KEY, 'cg-writer', '1-1')
  })

  it('INSERT 失败也 XACK+XDEL（失败即丢 D-P3-2）+ logger.error 留痕', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    client.xReadGroup
      .mockResolvedValueOnce(streamReply(KEY, [msg('1-1', { id: 1, tag: 'a' })]))
      .mockResolvedValue(null)
    const { createQueue } = await loadStore()
    createQueue(memoryOptions({ errorLabel: '[test queue] 写入失败:' }))
    await vi.advanceTimersByTimeAsync(5000)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockLogger.error).toHaveBeenCalledWith('[test queue] 写入失败:', expect.any(Error))
    expect(client.xAck).toHaveBeenCalledWith(KEY, 'cg-writer', '1-1')
    expect(client.xDel).toHaveBeenCalledWith(KEY, '1-1')
  })

  it('JSON.parse 毒消息丢弃留痕：不进 INSERT，仍 XACK+XDEL；同批正常消息照常落库', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    client.xReadGroup
      .mockResolvedValueOnce(
        streamReply(KEY, [
          { id: '1-1', message: { p: '{broken json' } },
          msg('1-2', { id: 2, tag: 'ok' }),
        ]),
      )
      .mockResolvedValue(null)
    const { createQueue } = await loadStore()
    createQueue(memoryOptions())
    await vi.advanceTimersByTimeAsync(5000)

    // 仅正常消息落库（毒消息不进 INSERT）
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([2, 'ok'])
    // 毒消息留痕 + 两条都出队（XACK+XDEL，失败即丢同口径）
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('毒消息'))
    expect(client.xAck).toHaveBeenCalledWith(KEY, 'cg-writer', '1-1')
    expect(client.xDel).toHaveBeenCalledWith(KEY, '1-1')
    expect(client.xAck).toHaveBeenCalledWith(KEY, 'cg-writer', '1-2')
    expect(client.xDel).toHaveBeenCalledWith(KEY, '1-2')
  })
})

// ============ ④ XADD 异常降级 ============

describe('XADD 异常 - catch 降级内存数组', () => {
  it('XADD 抛错 → warn 留痕 + 内存承接 → flushAll drain 落库（请求不阻塞不 500）', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    client.xAdd.mockRejectedValueOnce(new Error('WRONGTYPE'))
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions())
    await vi.advanceTimersByTimeAsync(5000) // warm

    q.push({ id: 1, tag: 'a' })
    await vi.waitFor(() => expect(q.getStats().size).toBe(1))
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('XADD 失败'))

    await q.flushAll() // 内存残留由 drain 落库（不并入 stream）
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([1, 'a'])
  })
})

// ============ ⑤ flushAll：stream 循环消费至空（≤20 轮）============

describe('flushAll - close 钩子语义', () => {
  it('内存 drain + stream 循环消费至空：空轮即停（轮 1 两次读各有消息，轮 2 皆空）', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions({ batchSize: 50 }))
    client.xReadGroup
      .mockResolvedValueOnce(streamReply(KEY, [msg('1-1', { id: 1, tag: 'a' })]))
      .mockResolvedValueOnce(streamReply(KEY, [msg('2-1', { id: 2, tag: 'b' })]))
      .mockResolvedValue(null)

    await q.flushAll()

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(client.xAck).toHaveBeenCalledTimes(2)
    expect(client.xDel).toHaveBeenCalledTimes(2)
    // 轮 1 两读有消息 → 轮 2 两读皆空 → 停（共 4 次读 + 2 次 XGROUP）
    expect(client.xReadGroup).toHaveBeenCalledTimes(4)
    expect(client.xGroupCreate).toHaveBeenCalledTimes(2)
  })

  it('stream 永不空时 20 轮封顶退出（防死循环）：每轮 2 读 × 1 条 → 至多 40 条 INSERT', async () => {
    const client = createFakeClient()
    mockGetRedis.mockReturnValue(client)
    client.xReadGroup.mockResolvedValue(streamReply(KEY, [msg('1-1', { id: 1, tag: 'a' })]))
    const { createQueue } = await loadStore()
    const q = createQueue(memoryOptions({ batchSize: 50 }))

    await q.flushAll() // 无上限则死循环超时失败

    expect(mockQuery).toHaveBeenCalledTimes(40)
    expect(client.xGroupCreate).toHaveBeenCalledTimes(20)
  })
})

// ============ ⑥ timer 注册即启动且 unref ============

describe('timer 生命周期', () => {
  it('timer 于 createQueue 注册即启动（无需首条 push——重启后 stream 存量被消费的前提）', async () => {
    const { createQueue } = await loadStore()
    expect(vi.getTimerCount()).toBe(0)
    createQueue(memoryOptions())
    expect(vi.getTimerCount()).toBe(1)
  })

  it('timer unref（真实句柄 hasRef()=false，不阻塞进程退出）', async () => {
    vi.useRealTimers()
    const { createQueue } = await loadStore()
    const realSetInterval = globalThis.setInterval
    const realClearInterval = globalThis.clearInterval
    const captured: { handle: NodeJS.Timeout | null } = { handle: null }
    globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const handle = realSetInterval(handler, timeout, ...args) as unknown as NodeJS.Timeout
      captured.handle = handle
      return handle
    }) as unknown as typeof setInterval
    try {
      // 60s 间隔防测试期间真实触发
      createQueue(memoryOptions({ flushIntervalMs: 60_000 }))
      const handle = captured.handle
      expect(handle).not.toBeNull()
      expect(handle?.hasRef()).toBe(false) // unref 后不再阻止事件循环退出
    } finally {
      globalThis.setInterval = realSetInterval
      if (captured.handle) realClearInterval(captured.handle)
    }
  })
})
