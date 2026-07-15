import { ref, onBeforeUnmount } from 'vue'

export function useRecorder() {
  const isRecording = ref(false)
  const isPaused = ref(false)
  const duration = ref(0)
  
  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  // 开始录音
  async function start(): Promise<void> {
    // SSR 保护
    if (!import.meta.client) return
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRecorder = new MediaRecorder(stream)
      chunks = []
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
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
      if (!mediaRecorder) {
        reject(new Error('没有正在进行的录音'))
        return
      }
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        cleanup()
        resolve(blob)
      }
      
      mediaRecorder.onerror = (event) => {
        console.error('录音错误:', event)
        cleanup()
        reject(event)
      }
      
      mediaRecorder.stop()
      isRecording.value = false
      isPaused.value = false
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
