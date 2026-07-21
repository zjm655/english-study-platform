import { ref, onBeforeUnmount } from 'vue'

// ============ 错误类型定义 ============
export type RecorderErrorType =
  | 'INSECURE_CONTEXT' // 非安全上下文（非 HTTPS / localhost）
  | 'API_NOT_SUPPORTED' // 浏览器不支持 MediaRecorder API
  | 'NO_DEVICE' // 未检测到麦克风设备
  | 'DEVICE_BUSY' // 麦克风被其他应用占用
  | 'USER_DENIED' // 用户点击"拒绝"
  | 'SYSTEM_DENIED' // 操作系统/浏览器策略拒绝
  | 'RECORDING_EMPTY' // 录音数据为空
  | 'RECORDING_ERROR' // 录音过程中发生错误
  | 'UNKNOWN' // 未知错误

export class RecorderError extends Error {
  public readonly type: RecorderErrorType
  public readonly originalError?: Error

  constructor(type: RecorderErrorType, message: string, originalError?: Error) {
    super(message)
    this.name = 'RecorderError'
    this.type = type
    this.originalError = originalError
  }
}

/** 根据 DOMException 分类生成 RecorderError */
function classifyGetUserMediaError(err: unknown): RecorderError {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError': {
        const msg = err.message || ''
        if (msg.includes('Permission denied by system')) {
          return new RecorderError(
            'SYSTEM_DENIED',
            '麦克风权限被系统阻止，请检查操作系统隐私设置或浏览器站点权限',
            err,
          )
        }
        return new RecorderError(
          'USER_DENIED',
          '麦克风权限被拒绝，请在浏览器地址栏左侧允许麦克风访问',
          err,
        )
      }
      case 'NotFoundError':
        return new RecorderError('NO_DEVICE', '未检测到麦克风设备，请连接麦克风后重试', err)
      case 'NotReadableError':
      case 'AbortError':
        return new RecorderError(
          'DEVICE_BUSY',
          '麦克风正在被其他应用使用，请关闭其他应用后重试',
          err,
        )
      case 'SecurityError':
        return new RecorderError(
          'INSECURE_CONTEXT',
          '当前页面不在安全环境中，请使用 HTTPS 或 localhost 访问',
          err,
        )
      default:
        return new RecorderError('UNKNOWN', `录音启动失败: ${err.message}`, err)
    }
  }

  if (err instanceof Error) {
    return new RecorderError('UNKNOWN', `录音启动失败: ${err.message}`, err)
  }

  return new RecorderError('UNKNOWN', '录音启动失败: 未知错误')
}

// ============ Composable ============
export function useRecorder() {
  const isRecording = ref(false)
  const isPaused = ref(false)
  const duration = ref(0)

  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  let stopResolve: ((blob: Blob) => void) | null = null
  let stopReject: ((error: Error) => void) | null = null

  // 精确计时相关
  let recordStartTime = 0
  let pausedDuration = 0
  let pauseStartTime = 0

  // 开始录音
  async function start(): Promise<void> {
    // SSR 保护
    if (!import.meta.client) return

    // 防止重复调用，先清理旧的
    if (mediaRecorder) {
      cleanup()
    }

    // ========== 三层防御检查 ==========

    // 1. 安全上下文检查
    if (!window.isSecureContext) {
      throw new RecorderError(
        'INSECURE_CONTEXT',
        '当前页面不在安全环境中（需 HTTPS 或 localhost），无法访问麦克风',
      )
    }

    // 2. API 可用性检查
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new RecorderError('API_NOT_SUPPORTED', '当前浏览器不支持录音功能，请更换浏览器后重试')
    }

    // 3. 设备存在性预检
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const hasAudioInput = devices.some((d) => d.kind === 'audioinput')
      if (!hasAudioInput) {
        throw new RecorderError('NO_DEVICE', '未检测到麦克风设备，请连接麦克风后重试')
      }
    } catch (err) {
      // enumerateDevices 本身也可能失败，继续尝试 getUserMedia
      logger.warn('enumerateDevices 预检失败:', err)
    }

    // ========== 请求麦克风权限 ==========
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
            stopReject(new RecorderError('RECORDING_EMPTY', '录音数据为空'))
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

      mediaRecorder.onerror = (event) => {
        cleanup()
        const originalError = (event as ErrorEvent).error as Error
        if (stopReject) {
          stopReject(
            new RecorderError(
              'RECORDING_ERROR',
              originalError?.message || '录音过程中发生错误',
              originalError,
            ),
          )
          stopResolve = null
          stopReject = null
        }
      }

      mediaRecorder.start()
      isRecording.value = true
      isPaused.value = false
      duration.value = 0

      // 精确计时初始化
      recordStartTime = Date.now()
      pausedDuration = 0
      pauseStartTime = 0

      // 使用 setInterval 做 UI 刷新，但用 Date.now() 差值计算时长
      timer = setInterval(() => {
        if (!isPaused.value) {
          const now = Date.now()
          duration.value = Math.floor((now - recordStartTime - pausedDuration) / 1000)
        }
      }, 500) // 每 500ms 刷新一次，提高 UI 响应性
    } catch (error) {
      logger.error('录音启动失败:', error)
      throw classifyGetUserMediaError(error)
    }
  }

  // 暂停
  function pause() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
      isPaused.value = true
      pauseStartTime = Date.now()
    }
  }

  // 恢复
  function resume() {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
      isPaused.value = false
      if (pauseStartTime > 0) {
        pausedDuration += Date.now() - pauseStartTime
        pauseStartTime = 0
      }
    }
  }

  // 停止并返回录音 Blob
  function stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        reject(new RecorderError('UNKNOWN', '没有正在进行的录音'))
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
      mediaRecorder.stream.getTracks().forEach((t) => t.stop())
      mediaRecorder = null
    }

    chunks = []
    duration.value = 0
    isRecording.value = false
    isPaused.value = false
    recordStartTime = 0
    pausedDuration = 0
    pauseStartTime = 0
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
    stop,
  }
}
