import { ref, onBeforeUnmount, getCurrentInstance } from 'vue'

/**
 * 通用轮询 Hook（指数衰减）
 *
 * 设计（参照 useStudyTimer 的定时器/可见性治理模式）：
 * - setTimeout 递归链（非 setInterval）：支持变长间隔，慢请求不重叠；
 * - 指数衰减：每轮间隔 ×factor，封顶 maxMs；start()/reset() 重置回 baseMs 并立即执行一轮；
 * - tick 返回 true 表示已达终态，自动 stop；
 * - 页面隐藏时完全停表（不发请求不推进衰减），回到可见立即执行一轮并重置衰减；
 * - 组件卸载自动 stop 并摘除监听。
 *
 * 用法：
 *   const { start, stop, reset } = usePolling(async () => {
 *     await refresh()
 *     return allDone.value // true → 自动停止
 *   })
 */
export interface UsePollingOptions {
  /** 起始间隔（ms），默认 3000 */
  baseMs?: number
  /** 间隔上限（ms），默认 30000 */
  maxMs?: number
  /** 衰减倍率，默认 2 */
  factor?: number
}

export function usePolling(
  tick: () => Promise<unknown> | unknown,
  options: UsePollingOptions = {},
) {
  const { baseMs = 3000, maxMs = 30000, factor = 2 } = options

  const isPolling = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let interval = baseMs
  /** tick 在途防重（可见性恢复与定时器触发并发时只跑一轮） */
  let ticking = false

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    clearTimer()
    timer = setTimeout(runTick, interval)
    interval = Math.min(interval * factor, maxMs)
  }

  async function runTick() {
    if (ticking) return
    ticking = true
    let done = false
    try {
      done = (await tick()) === true
    } catch {
      // tick 内部的请求层已各自归一化错误；轮询本身不因单轮异常中断
    }
    ticking = false
    if (!isPolling.value) return // 执行期间被 stop
    if (done) {
      stop()
      return
    }
    schedule()
  }

  function handleVisibilityChange() {
    if (!isPolling.value) return
    if (document.hidden) {
      // 隐藏 → 完全停表：不发请求、不推进衰减
      clearTimer()
    } else {
      // 恢复 → 立即执行一轮并重置衰减
      interval = baseMs
      void runTick()
    }
  }

  /** 启动轮询（已在轮询中则幂等忽略，需要提速用 reset()） */
  function start() {
    if (import.meta.server) return
    if (isPolling.value) return
    isPolling.value = true
    interval = baseMs
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void runTick()
  }

  /** 停止轮询并清理定时器/监听 */
  function stop() {
    isPolling.value = false
    clearTimer()
    if (import.meta.client) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  /** 重置衰减回 baseMs 并立即执行一轮（新任务提交后调用）；未启动则等价 start() */
  function reset() {
    if (!isPolling.value) {
      start()
      return
    }
    interval = baseMs
    clearTimer()
    void runTick()
  }

  // 组件内使用时卸载自动清理（对齐 useStudyTimer）；组件外调用需自行 stop
  if (getCurrentInstance()) {
    onBeforeUnmount(stop)
  }

  return { start, stop, reset, isPolling }
}
