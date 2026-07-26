import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { usePolling } from '../usePolling'

// ===== usePolling 测试 =====
// 覆盖：立即执行 / 指数衰减序列（3/6/12/24/30 封顶） / tick 返回 true 自动停止 /
// reset 重置衰减 / stop 幂等 / 组件卸载自动清理 / 页面隐藏停表恢复快轮

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('usePolling', () => {
  it('start 立即执行一轮，并按 3s→6s→12s→24s→30s 封顶衰减', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const { start, stop } = usePolling(tick)

    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1) // 立即一轮

    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6000)
    expect(tick).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(12000)
    expect(tick).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(24000)
    expect(tick).toHaveBeenCalledTimes(5)
    // 48000 被封顶为 30000
    await vi.advanceTimersByTimeAsync(30000)
    expect(tick).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(30000)
    expect(tick).toHaveBeenCalledTimes(7)

    stop()
  })

  it('tick 返回 true 时自动停止', async () => {
    const tick = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(true)
    const { start, isPolling } = usePolling(tick)

    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(isPolling.value).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(2)
    expect(isPolling.value).toBe(false)

    // 停止后不再触发
    await vi.advanceTimersByTimeAsync(60000)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('reset 重置衰减回 baseMs 并立即执行一轮', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const { start, reset, stop } = usePolling(tick)

    start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(6000)
    expect(tick).toHaveBeenCalledTimes(3) // 下一轮本应 12s 后

    reset()
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(4) // reset 立即一轮
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(5) // 衰减已重置回 3s

    stop()
  })

  it('未启动时 reset 等价 start；重复 start 幂等', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const { start, reset, isPolling, stop } = usePolling(tick)

    reset()
    await vi.advanceTimersByTimeAsync(0)
    expect(isPolling.value).toBe(true)
    expect(tick).toHaveBeenCalledTimes(1)

    start() // 已在轮询中：不立即再执行
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)

    stop()
  })

  it('单轮 tick 抛错不中断轮询', async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const { start, isPolling, stop } = usePolling(tick)

    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(isPolling.value).toBe(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(2)

    stop()
  })

  it('组件卸载自动停止轮询', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    let polling!: ReturnType<typeof usePolling>
    const Comp = defineComponent({
      setup() {
        polling = usePolling(tick)
        polling.start()
        return () => null
      },
    })
    const wrapper = mount(Comp)
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    expect(polling.isPolling.value).toBe(false)
    await vi.advanceTimersByTimeAsync(60000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('页面隐藏时停表，恢复可见立即执行并重置衰减', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const { start, stop } = usePolling(tick)

    start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(2)

    // 隐藏：停表，不再触发
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(tick).toHaveBeenCalledTimes(2)

    // 恢复：立即一轮 + 衰减重置回 3s
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(tick).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(4)

    stop()
  })
})
