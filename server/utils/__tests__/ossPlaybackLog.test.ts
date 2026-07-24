import { describe, it, expect, vi, beforeEach } from 'vitest'

// ossPlaybackLog 用模块级整型累加器 + 定时 flush，mock db.query 隔离落库、
// mock logger 避免 node 环境下 useRuntimeConfig 未定义；resetModules 保证每例独立状态。
// vi.hoisted / vi.mock 会被提升到 import 之上，故功能不受书写顺序影响。
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('../db', () => ({ query: mockQuery }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules() // 重置模块级 pendingCount / timer，隔离用例
})

async function importFresh() {
  return import('../ossPlaybackLog')
}

describe('ossPlaybackLog - 按天累加 + UPSERT flush', () => {
  it('flush 前不写库；flush 后以 CURDATE() UPSERT 累计次数', async () => {
    mockQuery.mockResolvedValue([])
    const { recordOssPlayback, flushOssPlaybackLog } = await importFresh()
    recordOssPlayback()
    recordOssPlayback()
    recordOssPlayback()
    expect(mockQuery).not.toHaveBeenCalled() // 未达阈值、定时器未触发

    await flushOssPlaybackLog()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT INTO oss_playback_daily')
    expect(sql).toContain('ON DUPLICATE KEY UPDATE')
    expect(sql).toContain('CURDATE()')
    expect(params).toEqual([3]) // 累计 3 次合并为一次写入
  })

  it('累计达到阈值(50)时自动立即 flush 一次', async () => {
    mockQuery.mockResolvedValue([])
    const { recordOssPlayback } = await importFresh()
    for (let i = 0; i < 50; i++) recordOssPlayback()
    // 阈值触发的是 void flush()（异步），等待微任务队列 flush 内的 query 被调用
    await Promise.resolve()
    await Promise.resolve()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0]![1]).toEqual([50])
  })

  it('空队列时 flush 不触发写库', async () => {
    mockQuery.mockResolvedValue([])
    const { flushOssPlaybackLog } = await importFresh()
    await flushOssPlaybackLog()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('写库失败回补计数，下次 flush 重试不丢计数', async () => {
    const { recordOssPlayback, flushOssPlaybackLog } = await importFresh()
    recordOssPlayback()
    recordOssPlayback()

    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await flushOssPlaybackLog() // 第一次失败，pendingCount 回补为 2
    expect(mockQuery).toHaveBeenCalledTimes(1)

    mockQuery.mockResolvedValueOnce([])
    await flushOssPlaybackLog() // 重试成功
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery.mock.calls[1]![1]).toEqual([2]) // 计数未丢
  })
})
