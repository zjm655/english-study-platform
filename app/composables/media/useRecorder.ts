import { ref, onBeforeUnmount } from 'vue'

export function useRecorder() {
  const isRecording = ref(false)
  const isPaused = ref(false)
  const duration = ref(0)
  
  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let stopResolve: ((blob: Blob) => void) | null = null
  let stopReject: ((error: Error) => void) | null = null

  // 开始录音
  async function start(): Promise<void> {
    // SSR 保护
    if (!import.meta.client) return
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder = new MediaRecorder(stream)
      chunks = []
      
      // 事件回调在 start 时统一绑定
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        // 空录音检查
        if (chunks.length === 0) {
          cleanup()
          if (stopReject) {
            stopReject(new Error('录音数据为空'))
            stopResolve = null
            stopReject = null
          }
          return
        }
        const blob = new Blob(chunks, { type: 'audio/webm' })
        cleanup()
        if (stopResolve) {
          stopResolve(blob)
          stopResolve = null
          stopReject = null
        }
      }
      
      mediaRecorder.onerror = () => {
        cleanup()
        if (stopReject) {
          stopReject(new Error('录音过程中发生错误'))
          stopResolve = null
          stopReject = null
        }
      }
      
      mediaRecorder.start()
      isRecording.value = true
      isPaused.value = false
      duration.value = 0
      
      // 每秒更新时长
      timer = setInterval(() => {
        if (!isPaused.value) {
          duration.value++
        }
      }, 1000)
    } catch (error) {
      console.error('录音启动失败:', error)
      throw error
    }
  }

  // 暂停
  function pause() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
      isPaused.value = true
    }
  }

  // 恢复
  function resume() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
      isPaused.value = false
    }
  }

  // 停止并返回录音 Blob
  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        reject(new Error('没有正在进行的录音'))
        return
      }
      
      // 先清 timer，不依赖 onstop 回调链
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      
      // 保存 resolve/reject 供 onstop/onerror 回调使用
      stopResolve = resolve
      stopReject = reject
      
      isRecording.value = false
      isPaused.value = false
      mediaRecorder.stop()
    })
  }

  // 清理资源
  function cleanup() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    
    if (mediaRecorder) {
      mediaRecorder.stream.getTracks().forEach(t => t.stop())
      mediaRecorder = null
    }
    
    chunks = []
    duration.value = 0
    isRecording.value = false
    isPaused.value = false
  }

  // 组件卸载时自动清理
  onBeforeUnmount(cleanup)

  return {
    isRecording,
    isPaused,
    duration,
    start,
    pause,
    resume,
    stop
  }
}
