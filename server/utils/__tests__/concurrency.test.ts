import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../concurrency'

describe('mapWithConcurrency', () => {
  it('返回结果与输入顺序一致', async () => {
    const input = [1, 2, 3, 4, 5]
    const result = await mapWithConcurrency(input, 2, async (n) => n * 10)
    expect(result).toEqual([10, 20, 30, 40, 50])
  })

  it('空数组返回空数组，不调用 fn', async () => {
    let called = 0
    const result = await mapWithConcurrency([], 3, async (n) => {
      called++
      return n
    })
    expect(result).toEqual([])
    expect(called).toBe(0)
  })

  it('并发数不超过限制', async () => {
    let running = 0
    let maxRunning = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    await mapWithConcurrency(items, 3, async (n) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return n
    })
    expect(maxRunning).toBeLessThanOrEqual(3)
    expect(maxRunning).toBeGreaterThan(1) // 确实并发了
  })

  it('并发数下限为 1（传入 0/负数不会死循环）', async () => {
    const result = await mapWithConcurrency([1, 2, 3], 0, async (n) => n + 1)
    expect(result).toEqual([2, 3, 4])
  })

  it('任一任务抛错则整体 reject', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})
