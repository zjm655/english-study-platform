<script setup lang="ts">
import { useRecorder, RecorderError } from '~/composables/media/useRecorder'
import { toastError } from '~/utils/popup'

const emit = defineEmits<{
  (e: 'recorded', payload: { blob: Blob; duration: number }): void
  (e: 'recording-start'): void
  (e: 'recording-stop'): void
  (e: 'error', message: string): void
}>()

// === 录音 ===
const { isRecording, isPaused, duration, start, pause, resume, stop } = useRecorder()

// === 录音权限/错误状态 ===
const permissionError = ref('')

// === 上传失败时保留的 Blob，用于重试 ===
const pendingBlob = ref<Blob | null>(null)
const isUploadError = ref(false)

// === 本地文件选择 ref ===
const fileInputRef = ref<HTMLInputElement | null>(null)

// === 格式化时长 ===
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// === 开始/暂停切换 ===
async function toggleRecording() {
  permissionError.value = ''

  if (!isRecording.value) {
    try {
      await start()
      emit('recording-start')
    } catch (err) {
      if (err instanceof RecorderError) {
        permissionError.value = err.message
        toastError(err.message)
        emit('error', err.message)
      } else if (err instanceof Error) {
        const msg = `录音启动失败: ${err.message}`
        permissionError.value = msg
        toastError(msg)
        emit('error', msg)
      } else {
        const msg = '录音启动失败，请检查麦克风权限后重试'
        permissionError.value = msg
        toastError(msg)
        emit('error', msg)
      }
    }
  } else if (isPaused.value) {
    resume()
  } else {
    pause()
  }
}

// === 结束录音并上传 ===
async function finishRecording() {
  if (!isRecording.value) return
  isUploadError.value = false
  pendingBlob.value = null

  try {
    const finalDuration = duration.value
    const blob = await stop()
    emit('recording-stop')
    emit('recorded', { blob, duration: finalDuration })
  } catch (err) {
    console.error('录音处理失败:', err)
    if (err instanceof Error) {
      toastError(err.message)
    } else {
      toastError('录音处理失败，请重试')
    }
  }
}

// === 重试上传 ===
async function retryUpload() {
  if (!pendingBlob.value) return
  isUploadError.value = false
  try {
    emit('recorded', { blob: pendingBlob.value, duration: duration.value })
    pendingBlob.value = null
  } catch (err) {
    isUploadError.value = true
    if (err instanceof Error) {
      toastError(`重试上传失败: ${err.message}`)
    } else {
      toastError('重试上传失败')
    }
  }
}

// === 本地文件选择 ===
function triggerFileSelect() {
  fileInputRef.value?.click()
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const allowedTypes = [
    'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav',
    'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a',
  ]
  if (!allowedTypes.includes(file.type)) {
    toastError(`不支持的音频格式: ${file.type}，请选择 webm、ogg、wav、mp3 文件`)
    input.value = ''
    return
  }

  if (file.size > 50 * 1024 * 1024) {
    toastError('文件大小超过 50MB 限制')
    input.value = ''
    return
  }

  isUploadError.value = false
  pendingBlob.value = null
  permissionError.value = ''

  try {
    const fileDuration = await getAudioDuration(file)
    emit('recorded', { blob: file, duration: fileDuration })
  } catch (err) {
    console.error('文件上传失败:', err)
    toastError('上传失败，请重试')
  }

  input.value = ''
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      resolve(Math.floor(audio.duration) || 0)
      URL.revokeObjectURL(audio.src)
    }
    audio.onerror = () => {
      resolve(0)
      URL.revokeObjectURL(audio.src)
    }
    audio.src = URL.createObjectURL(file)
  })
}
</script>

<template>
  <div class="voice-recorder">
    <!-- 权限错误提示 -->
    <div v-if="permissionError" class="permission-error">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
      <span>{{ permissionError }}</span>
    </div>

    <!-- 本地文件选择（仅录音失败后显示） -->
    <div v-if="permissionError" class="file-upload-fallback">
      <input
        ref="fileInputRef"
        type="file"
        accept=".webm,.ogg,.wav,.mp3,.mp4,audio/webm,audio/ogg,audio/wav,audio/mpeg,audio/mp4"
        class="file-input-hidden"
        @change="handleFileSelected"
      />
      <button class="fallback-btn" @click="triggerFileSelect">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
        </svg>
        从本地选择音频文件
      </button>
      <p class="fallback-hint">支持 webm、ogg、wav、mp3 格式</p>
    </div>

    <!-- 上传失败提示 + 重试 -->
    <div v-if="isUploadError && pendingBlob" class="upload-error">
      <span>上传失败</span>
      <button class="retry-btn" @click="retryUpload">重试上传</button>
    </div>

    <!-- 波形条可视化 -->
    <div class="wave-bars" aria-hidden="true">
      <div
        v-for="i in 7"
        :key="i"
        class="bar"
        :class="{
          'bar--recording': isRecording && !isPaused,
          'bar--paused': isRecording && isPaused,
        }"
        :style="{ animationDelay: `${(i - 1) * 0.1}s` }"
      ></div>
    </div>

    <!-- 时长显示 -->
    <div class="duration-display">
      {{ formatDuration(duration) }}
    </div>

    <!-- 操作按钮 -->
    <div class="record-actions">
      <button
        class="action-btn action-btn--stop"
        aria-label="结束录制"
        :disabled="!isRecording"
        @click="finishRecording"
      >
        <div class="action-btn__icon stop-icon"></div>
      </button>

      <button
        class="action-btn action-btn--main"
        :aria-label="isRecording ? '暂停录制' : '开始录制'"
        :class="{ 'action-btn--recording': isRecording }"
        @click="toggleRecording"
      >
        <svg v-if="!isRecording || isPaused" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
        </svg>
      </button>

      <button class="action-btn action-btn--volume" disabled aria-label="音量调节（开发中）" title="音量调节（开发中）">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ===== 权限/上传错误提示 ===== */
.permission-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(245, 108, 108, 0.08);
  border: 1px solid rgba(245, 108, 108, 0.2);
  border-radius: var(--r);
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--danger);
  line-height: 1.5;
}

.permission-error svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.upload-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(245, 108, 108, 0.08);
  border: 1px solid rgba(245, 108, 108, 0.2);
  border-radius: var(--r);
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--danger);
}

.retry-btn {
  padding: 4px 10px;
  background: var(--danger);
  border: none;
  border-radius: var(--r);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.retry-btn:hover {
  opacity: 0.9;
}

/* ===== 本地文件选择备选 ===== */
.file-upload-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.file-input-hidden {
  display: none;
}

.fallback-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--primary-light);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.fallback-btn svg {
  width: 16px;
  height: 16px;
}

.fallback-btn:active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.fallback-hint {
  font-size: 12px;
  color: var(--text-3);
}

/* ===== 波形条 ===== */
.wave-bars {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 60px;
  margin-bottom: 12px;
}

.bar {
  width: 4px;
  background: var(--primary);
  border-radius: 2px;
  height: 20%;
  transition: background 0.2s;
}

.bar--recording {
  animation: wave 1s ease-in-out infinite;
}

.bar--paused {
  animation-play-state: paused;
  background: var(--warning);
}

@keyframes wave {
  0%, 100% { height: 20%; }
  50% { height: 100%; }
}

.duration-display {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1);
  font-family: 'Courier New', monospace;
  margin-bottom: 16px;
}

.record-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.2s, transform 0.2s, opacity 0.2s;
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn--stop {
  width: 44px;
  height: 44px;
  background: var(--card);
  border: 2px solid var(--border-ll);
  color: var(--text-3);
}

.action-btn--stop:not(:disabled):active {
  background: var(--danger-light);
  border-color: var(--danger);
  color: var(--danger);
}

.stop-icon {
  width: 14px;
  height: 14px;
  background: currentColor;
  border-radius: 2px;
}

.action-btn--main {
  width: 64px;
  height: 64px;
  background: var(--primary);
  color: #fff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
}

.action-btn--main svg {
  width: 28px;
  height: 28px;
}

.action-btn--main:not(:disabled):active {
  transform: scale(0.95);
  opacity: 0.9;
}

.action-btn--main.action-btn--recording {
  background: var(--danger);
  box-shadow: 0 4px 12px rgba(245, 108, 108, 0.3);
}

.action-btn--volume {
  width: 44px;
  height: 44px;
  background: var(--card);
  border: 2px solid var(--border-ll);
  color: var(--text-3);
}

.action-btn--volume svg {
  width: 20px;
  height: 20px;
}
</style>
