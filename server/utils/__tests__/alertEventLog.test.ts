import { describe, it, expect, vi, beforeEach } from 'vitest'

// alertEventLog 用模块级内存队列 + 定时 flush，mock db.query 隔离落库、
// mock logger 避免 node 环境下 useRuntimeConfig 未定义；resetModules 保证每例独立状态。
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('../db', () => ({ query: mockQuery }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules() // 重置模块级 queue / timer，隔离用例
})

async function importFresh() {
  return import('../alertEventLog')
}

describe('alertEventLog - 批量写入 + requestId 填充', () => {
  it('flush 前不写库；flush 后批量 INSERT 全部字段', async () => {
    mockQuery.mockResolvedValue([])
    const { logAlertEvent, flushAlertEventLog } = await importFresh()
    logAlertEvent({
      source: 'task_fail',
      level: 'error',
      code: 'task_fail',
      message: '材料上传任务失败: 测试',
      userId: 7,
      context: { recordId: 42 },
    })
    logAlertEvent({ source: 'log_queue', level: 'warn', code: 'log_queue_dropped' })
    expect(mockQuery).not.toHaveBeenCalled() // 未达阈值、定时器未触发

    await flushAlertEventLog()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT INTO alert_event')
    expect(params).toEqual([
      'task_fail',
      'error',
      'task_fail',
      '材料上传任务失败: 测试',
      null, // requestId：无请求上下文 → null
      7,
      JSON.stringify({ recordId: 42 }),
      'log_queue',
      'warn',
      'log_queue_dropped',
      null, // message 空 → NULL
      null,
      null,
      null,
    ])
  })

  it('message 超长截断 500；context 缺省为 NULL', async () => {
    mockQuery.mockResolvedValue([])
    const { logAlertEvent, flushAlertEventLog } = await importFresh()
    logAlertEvent({ source: 'client_error', message: 'x'.repeat(600) })
    await flushAlertEventLog()
    const params = mockQuery.mock.calls[0]![1] as unknown[]
    expect(params[3]).toHaveLength(500)
    expect(params[6]).toBeNull() // context 缺省 → NULL
  })

  it('达到阈值(50)时自动立即 flush 一次', async () => {
    mockQuery.mockResolvedValue([])
    const { logAlertEvent } = await importFresh()
    for (let i = 0; i < 50; i++) logAlertEvent({ source: 'client_error', message: `err${i}` })
    // 阈值触发的是 void flush()（异步），等待微任务队列 flush 内的 query 被调用
    await Promise.resolve()
    await Promise.resolve()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery.mock.calls[0]![1]).toHaveLength(50 * 7)
  })

  it('写库失败静默吞错（旁路原则），不阻塞后续写入', async () => {
    const { logAlertEvent, flushAlertEventLog } = await importFresh()
    logAlertEvent({ source: 'client_error', message: 'boom' })
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await flushAlertEventLog() // 失败仅 logger.error，不抛
    expect(mockQuery).toHaveBeenCalledTimes(1)
    // 队列已 splice 丢弃本批，下一批可正常写入
    logAlertEvent({ source: 'task_fail', message: 'after' })
    mockQuery.mockResolvedValueOnce([])
    await flushAlertEventLog()
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})
