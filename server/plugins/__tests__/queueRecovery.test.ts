/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 启动恢复插件回归：Nitro runNitroPlugins 同步调用插件且不 await 返回的 Promise，
// 插件执行期间服务已可受理请求——恢复 UPDATE 必须以插件初始化时刻为界
// （createdAt < startedAt），否则启动窗口期新建的 queued 记录会被误标 failed。

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.hoisted(() => {
  ;(globalThis as any).defineNitroPlugin = (fn: any) => fn
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

vi.mock('#server/utils/db', () => ({ query: mockQuery }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('queueRecovery 启动恢复插件', () => {
  it('恢复 UPDATE 带 createdAt < 启动时刻 条件，只标记重启前遗留任务', async () => {
    mockQuery.mockResolvedValue({ affectedRows: 2 })
    const before = new Date()
    const plugin = (await import('../02.queueRecovery')).default as unknown as () => void
    plugin()
    // 插件本体同步返回，恢复逻辑在内部 IIFE 中异步执行
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    const after = new Date()

    const [sql, params] = mockQuery.mock.calls[0]! as [string, unknown[]]
    expect(sql).toContain(`status IN ('queued', 'processing')`)
    expect(sql).toContain('createdAt < ?')
    const startedAt = params[0] as Date
    expect(startedAt).toBeInstanceOf(Date)
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(startedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('查询失败（如迁移未执行）不向外抛出，插件本体不阻塞启动', async () => {
    mockQuery.mockRejectedValue(new Error('table not found'))
    const plugin = (await import('../02.queueRecovery')).default as unknown as () => void
    expect(() => plugin()).not.toThrow()
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
  })
})
