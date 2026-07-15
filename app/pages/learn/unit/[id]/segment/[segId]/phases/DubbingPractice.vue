<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useRecorder } from '~/composables/media/useRecorder'
import { useUploadRecording, useRecordingList, useAnalyzeRecording } from '~/composables/recording'
import type { SegmentDetail } from '~~/shared/types/unit'
import type { Recording, WordScore } from '#shared/types/recording'
import { RecorderError } from '~/composables/media/useRecorder'
import { toastError, toastInfo } from '~/utils/popup'

interface Props {
  segment: SegmentDetail
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'complete'): void
}>()

// 录音
const { isRecording, isPaused, duration, start, pause, resume, stop } = useRecorder()

// 音频播放（材料 + 录音回放，共享全局 Howler）
const { load: loadAudio, play: playAudio } = useAudioPlayer()

// API
const { execute: uploadRecording, isLoading: isUploading } = useUploadRecording()
const { execute: fetchRecordingList, isLoading: isListLoading } = useRecordingList()
const { execute: analyzeRecording, isLoading: isAnalyzing } = useAnalyzeRecording()
const { execute: updateProgress, isLoading: isUpdating } = useUpdateProgress()

// UI 状态
const translationExpanded = ref(false)
const recordings = ref<Recording[]>([])
const selectedRecordingId = ref<number | null>(null)

// 录音权限/错误状态
const permissionError = ref('')

// 上传失败时保留的 Blob，用于重试
const pendingBlob = ref<Blob | null>(null)
const isUploadError = ref(false)

// 列表加载错误
const isListError = ref(false)
const listErrorMsg = ref('')

// 当前选中的录音
const selectedRecording = computed(() =>
  recordings.value.find(r => r.id === selectedRecordingId.value) || null
)

// 当前选中录音是否有分析结果
const hasAnalysis = computed(() =>
  selectedRecording.value?.score !== null && selectedRecording.value?.score !== undefined
)

// 最高分
const bestScore = computed(() => {
  const scores = recordings.value
    .filter(r => r.score !== null)
    .map(r => r.score as number)
  return scores.length > 0 ? Math.max(...scores) : null
})

// 完成按钮是否可用
const canComplete = computed(() => bestScore.value !== null)

// 格式化时长
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 播放材料音频
async function playMaterialAudio() {
  if (!props.segment.audioUrl) return
  await loadAudio(props.segment.audioUrl)
  playAudio()
}

// 开始/暂停切换
async function toggleRecording() {
  // 清除之前的权限错误提示
  permissionError.value = ''

  if (!isRecording.value) {
    try {
      await start()
    } catch (err) {
      if (err instanceof RecorderError) {
        permissionError.value = err.message
        toastError(err.message)
      } else if (err instanceof Error) {
        const msg = `录音启动失败: ${err.message}`
        permissionError.value = msg
        toastError(msg)
      } else {
        const msg = '录音启动失败，请检查麦克风权限后重试'
        permissionError.value = msg
        toastError(msg)
      }
    }
  } else if (isPaused.value) {
    resume()
  } else {
    pause()
  }
}

// 结束录音并上传
async function finishRecording() {
  if (!isRecording.value) return
  isUploadError.value = false
  pendingBlob.value = null

  try {
    const blob = await stop()
    await doUpload(blob)
  } catch (err) {
    console.error('录音处理失败:', err)
    if (err instanceof Error) {
      toastError(err.message)
    } else {
      toastError('录音处理失败，请重试')
    }
  }
}

// 执行上传（可被重试调用）
async function doUpload(blob: Blob) {
  const res = await uploadRecording({
    audioBlob: blob,
    segmentId: props.segment.id,
    phase: 3,
    duration: duration.value,
  })
  if (res?.code === 200 && res.data) {
    isUploadError.value = false
    pendingBlob.value = null
    await loadRecordings()
    selectedRecordingId.value = res.data.id
  } else {
    // 保留 blob 供用户重试
    pendingBlob.value = blob
    isUploadError.value = true
    const msg = res?.message || '上传失败，请检查网络后重试'
    toastError(msg)
  }
}

// 重试上传
async function retryUpload() {
  if (!pendingBlob.value) return
  isUploadError.value = false
  try {
    await doUpload(pendingBlob.value)
  } catch (err) {
    isUploadError.value = true
    if (err instanceof Error) {
      toastError(`重试上传失败: ${err.message}`)
    } else {
      toastError('重试上传失败')
    }
  }
}

// 播放录音
async function playRecording() {
  if (!selectedRecording.value?.audioPath) return
  const url = selectedRecording.value.audioPath.startsWith('/')
    ? selectedRecording.value.audioPath
    : `/${selectedRecording.value.audioPath}`
  await loadAudio(url)
  playAudio()
}

// 发起分析
async function handleAnalyze() {
  if (!selectedRecordingId.value || isAnalyzing.value) return
  try {
    const res = await analyzeRecording(selectedRecordingId.value)
    if (res?.code === 200 && res.data) {
      const idx = recordings.value.findIndex(r => r.id === res.data!.id)
      if (idx !== -1) {
        recordings.value[idx] = res.data
      }
    } else {
      toastError(res?.message || '分析失败，请稍后重试')
    }
  } catch (err) {
    console.error('分析请求失败:', err)
    toastError('分析请求失败，请检查网络后重试')
  }
}

// 选中一条录音
function selectRecording(id: number) {
  selectedRecordingId.value = id
}

// 完成配音
async function completePhase() {
  if (!canComplete.value || isUpdating.value) return
  const res = await updateProgress({
    segmentId: props.segment.id,
    phase: 3,
    done: true,
    score: bestScore.value!,
  })
  if (res?.code === 200) {
    emit('complete')
  }
}

// 加载录音列表
async function loadRecordings() {
  isListError.value = false
  listErrorMsg.value = ''
  try {
    const res = await fetchRecordingList({
      segmentId: props.segment.id,
      phase: 3,
    })
    if (res?.code === 200 && res.data) {
      recordings.value = res.data
    } else {
      isListError.value = true
      listErrorMsg.value = res?.message || '加载录音列表失败'
    }
  } catch (err) {
    console.error('加载录音列表失败:', err)
    isListError.value = true
    listErrorMsg.value = '网络异常，加载录音列表失败'
  }
}

// 获取词的颜色类
function getWordStatusClass(word: WordScore): string {
  switch (word.status) {
    case 'correct': return 'word--correct'
    case 'minor': return 'word--minor'
    case 'wrong': return 'word--wrong'
    case 'missing': return 'word--missing'
    default: return ''
  }
}

onMounted(() => {
  loadRecordings()
})
</script>

<template>
  <div class="dubbing-practice">
    <!-- 卡片 1：原文 -->
    <div class="card">
      <div class="card__header">
        <span>原文</span>
        <button
          v-if="segment.audioUrl"
          class="material-play-btn"
          @click="playMaterialAudio"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          播放材料
        </button>
      </div>
      <div class="card__body text-content">
        {{ segment.textContent }}
      </div>
    </div>

    <!-- 卡片 2：翻译（可折叠） -->
    <div class="card">
      <div class="card__header card__header--clickable" @click="translationExpanded = !translationExpanded">
        <span>翻译</span>
        <svg
          class="arrow-icon"
          :class="{ 'arrow-icon--expanded': translationExpanded }"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>
      <div v-show="translationExpanded" class="card__body translation-content">
        {{ segment.translation || '暂无翻译' }}
      </div>
    </div>

    <!-- 卡片 3：录音操作 -->
    <div class="card">
      <div class="card__header">录音</div>

      <!-- 权限错误提示 -->
      <div v-if="permissionError" class="permission-error">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
        <span>{{ permissionError }}</span>
      </div>

      <!-- 上传失败提示 + 重试 -->
      <div v-if="isUploadError && pendingBlob" class="upload-error">
        <span>上传失败</span>
        <button class="retry-btn" @click="retryUpload">重试上传</button>
      </div>

      <!-- 波形条可视化（装饰性，非真实音频数据） -->
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
        <!-- 左：结束录制 -->
        <button
          class="action-btn action-btn--stop"
          aria-label="结束录制"
          :disabled="!isRecording"
          @click="finishRecording"
        >
          <div class="action-btn__icon stop-icon"></div>
        </button>

        <!-- 中：开始/暂停 -->
        <button
          class="action-btn action-btn--main"
          :aria-label="isRecording ? '暂停录制' : '开始录制'"
          :class="{ 'action-btn--recording': isRecording }"
          :disabled="isUploading"
          @click="toggleRecording"
        >
          <svg v-if="!isRecording || isPaused" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        </button>

        <!-- 右：音量调节（占位） -->
        <button class="action-btn action-btn--volume" disabled aria-label="音量调节（开发中）" title="音量调节（开发中）">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
        </button>
      </div>

      <!-- 上传中提示 -->
      <div v-if="isUploading" class="uploading-tip" aria-live="polite">
        <DotPulse />
        <span>正在上传...</span>
      </div>
    </div>

    <!-- 卡片 4：录音文件列表 -->
    <div class="card">
      <div class="card__header">
        <span>我的录音</span>
        <span class="recording-count">{{ recordings.length }} 条</span>
      </div>

      <div v-if="isListLoading" class="card__body empty-state">
        <DotPulse />
      </div>

      <div v-else-if="isListError" class="card__body empty-state">
        <p>{{ listErrorMsg }}</p>
        <button class="retry-btn retry-btn--small" @click="loadRecordings">重新加载</button>
      </div>

      <div v-else-if="recordings.length === 0" class="card__body empty-state">
        <p>还没有录音，点击上方按钮开始录制</p>
      </div>

      <div v-else class="recording-list">
        <div
          v-for="item in recordings"
          :key="item.id"
          class="recording-item"
          :class="{ 'recording-item--selected': item.id === selectedRecordingId }"
          @click="selectRecording(item.id)"
        >
          <div class="recording-item__info">
            <span class="recording-item__time">{{ formatDuration(item.duration) }}</span>
            <span v-if="item.score !== null" class="recording-item__score">
              {{ item.score }} 分
            </span>
          </div>
          <div class="recording-item__date">
            {{ new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.createdAt)) }}
          </div>
        </div>

        <!-- 选中录音的操作按钮 -->
        <div v-if="selectedRecording" class="selected-actions">
          <button class="selected-action-btn" @click="playRecording">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放录音
          </button>
          <button
            class="selected-action-btn selected-action-btn--primary"
            :disabled="isAnalyzing"
            @click="handleAnalyze"
          >
            <template v-if="isAnalyzing">
              <DotPulse />
              分析中
            </template>
            <template v-else>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
              {{ hasAnalysis ? '重新分析' : '发起分析' }}
            </template>
          </button>
        </div>
      </div>
    </div>

    <!-- 卡片 5：AI 分析结果 -->
    <div class="card">
      <div class="card__header">AI 评分</div>

      <div v-if="!selectedRecording || !hasAnalysis" class="card__body empty-state">
        <p>选择一条录音并发起分析</p>
      </div>

      <div v-else class="analysis-result">
        <!-- 综合评分 -->
        <div class="score-section">
          <div class="score-number">{{ selectedRecording.score }}</div>
          <div class="score-label">综合评分</div>
          <div class="score-bar">
            <div class="score-bar__fill" :style="{ width: `${selectedRecording.score}%` }"></div>
          </div>
        </div>

        <!-- AI 反馈 -->
        <div class="feedback-section">
          <div class="feedback-title">AI 评价</div>
          <p class="feedback-text">{{ selectedRecording.feedback }}</p>
        </div>

        <!-- 逐词评分 -->
        <div class="word-scores-section">
          <div class="word-scores-title">逐词评分</div>
          <div class="word-scores">
            <span
              v-for="(word, idx) in selectedRecording.wordScores || []"
              :key="idx"
              class="word-score"
              :class="getWordStatusClass(word)"
              :title="`${word.word}: ${word.score} 分`"
            >
              {{ word.word }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 完成按钮 -->
    <button
      class="complete-btn"
      :class="{ 'complete-btn--active': canComplete }"
      :disabled="!canComplete || isUpdating"
      @click="completePhase"
    >
      <template v-if="isUpdating">
        <DotPulse />
      </template>
      <template v-else>
        完成配音
      </template>
    </button>
  </div>
</template>

<style scoped>
.dubbing-practice {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 100%;
  overflow-y: auto;
}

/* ===== 卡片通用样式 ===== */
.card {
  background: var(--bg);
  border-radius: var(--r);
  padding: 16px;
}

.card__header {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card__header--clickable {
  cursor: pointer;
}

.card__body {
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.6;
}

/* ===== 原文卡片 ===== */
.text-content {
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-1);
}

.material-play-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--primary-light);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.material-play-btn svg {
  width: 14px;
  height: 14px;
}

.material-play-btn:active {
  background: var(--primary);
  color: #fff;
}

/* ===== 翻译卡片 ===== */
.arrow-icon {
  width: 18px;
  height: 18px;
  color: var(--text-3);
  transition: transform 0.2s;
}

.arrow-icon--expanded {
  transform: rotate(180deg);
}

.translation-content {
  padding-top: 8px;
  border-top: 1px solid var(--border-ll);
  color: var(--text-2);
}

/* ===== 录音卡片 ===== */
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

.uploading-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-3);
}

/* ===== 录音列表卡片 ===== */
.recording-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-3);
}

.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--text-3);
  font-size: 13px;
}

.recording-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recording-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.recording-item:hover {
  border-color: var(--primary);
}

.recording-item--selected {
  border-color: var(--primary);
  background: rgba(64, 158, 255, 0.05);
}

.recording-item__info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.recording-item__time {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  font-family: 'Courier New', monospace;
}

.recording-item__score {
  font-size: 12px;
  color: var(--success);
  font-weight: 600;
}

.recording-item__date {
  font-size: 12px;
  color: var(--text-3);
}

.selected-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.selected-action-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.selected-action-btn svg {
  width: 16px;
  height: 16px;
}

.selected-action-btn:not(:disabled):active {
  background: var(--bg);
}

.selected-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.selected-action-btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.selected-action-btn--primary:not(:disabled):active {
  opacity: 0.9;
  background: var(--primary);
}

/* ===== 分析结果卡片 ===== */
.analysis-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.score-section {
  text-align: center;
}

.score-number {
  font-size: 48px;
  font-weight: 700;
  color: var(--primary);
  line-height: 1;
  margin-bottom: 4px;
}

.score-label {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 12px;
}

.score-bar {
  height: 6px;
  background: var(--border-ll);
  border-radius: 3px;
  overflow: hidden;
}

.score-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--success));
  border-radius: 3px;
  transition: width 0.5s ease;
}

.feedback-section {
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
}

.feedback-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.feedback-text {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
  margin: 0;
}

.word-scores-section {
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
}

.word-scores-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 10px;
}

.word-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
}

.word-score {
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: default;
  transition: opacity 0.2s;
}

.word--correct {
  color: var(--success);
  background: rgba(103, 194, 58, 0.1);
}

.word--minor {
  color: var(--warning);
  background: var(--warning-light);
}

.word--wrong {
  color: var(--danger);
  background: rgba(245, 108, 108, 0.1);
}

.word--missing {
  color: var(--text-3);
  background: var(--bg);
  text-decoration: line-through;
}

/* ===== 完成按钮 ===== */
.complete-btn {
  width: 100%;
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--text-3);
  font-size: 15px;
  font-weight: 500;
  cursor: not-allowed;
  transition: background 0.2s, border-color 0.2s, color 0.2s, opacity 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.complete-btn--active:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  cursor: pointer;
}

.complete-btn--active:not(:disabled):active {
  opacity: 0.9;
}

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

.retry-btn--small {
  margin-top: 8px;
  padding: 6px 14px;
  font-size: 13px;
}
</style>
