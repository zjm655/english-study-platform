import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useStudyTime } from './useStudyTime'

const REPORT_INTERVAL = 30000 // 30s 上报间隔

/**
 * 学习时长定时器 Hook（第二层）
 * - 自动启动 60s 定时器，定期上报学习时长
 * - 页面隐藏时暂停，恢复时继续
 * - 组件销毁时上报剩余时长并清理
 * - 返回 isTracking 表示是否正在计时
 */
export function useStudyTimer() {
  const { execute:reportStudyTime } = useStudyTime()
  const isTracking = ref(false)

  let startTime: number | null = null
  let accumulatedMs = 0
  let timer: ReturnType<typeof setInterval> | null = null

  // 获取当前已流逝的毫秒数（含暂停前已累计的部分）
  function getElapsedMs() {
    if (startTime === null) return accumulatedMs
    return Date.now() - startTime + accumulatedMs
  }

  // 上报并重置计时
  function report() {
    const elapsedMs = getElapsedMs()
    const seconds = Math.floor(elapsedMs / 1000)
    if (seconds > 0) {
      logger.log(`[StudyTimer] 上报学习时长: ${seconds} 秒`)
      reportStudyTime(seconds)
      startTime = Date.now()
      accumulatedMs = 0
    }
    // 如果 seconds === 0，保留当前计时，不清零
  }

  // 启动定时器
  function startTimer() {
    if (timer !== null) return
    startTime = Date.now()
    timer = setInterval(report, REPORT_INTERVAL)
    isTracking.value = true
  }

  // 停止定时器（不上报）
  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    isTracking.value = false
  }

  // 页面可见性变化处理
  function handleVisibilityChange() {
    if (document.hidden) {
      // 隐藏 → 暂停：把当前 elapsed 收入 accumulated，清定时器
      logger.log('[StudyTimer] 页面隐藏，暂停计时')
      if (startTime !== null) {
        accumulatedMs += Date.now() - startTime
        startTime = null
      }
      stopTimer()
    } else {
      // 恢复 → 继续：重启定时器，startTime 在 startTimer 里重置
      logger.log('[StudyTimer] 页面恢复，继续计时')
      startTimer()
    }
  }

  onMounted(() => {
    logger.log('[StudyTimer] 计时器启动，上报基准时间')
    // 立即上报 0 秒，建立 updatedAt 基准
    reportStudyTime(0)
    startTimer()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    logger.log('[StudyTimer] 计时器销毁，上报剩余时长')
    // 销毁前上报剩余时长
    report()
    stopTimer()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return { isTracking }
}
