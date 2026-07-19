<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useRecordingList, useAnalyzeRecording } from '~/composables/recording'
import type { SegmentDetail } from '~~/shared/types/unit'
import type { Recording, WordScore } from '#shared/types/recording'
import { toastError } from '~/utils/popup'
import { getEvaluationAuth } from '~/api/evaluation/auth'
import { useUserStore } from '~/store/useUserStore'
import { useSpeechEvaluation } from '~/composables/evaluation/useSpeechEvaluation'

interface Props {
  segment: SegmentDetail
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'complete'): void
}>()

// 音频播放（材料 + 录音回放，共享全局 Howler）
const { load: loadAudio, play: playAudio } = useAudioPlayer()

// API
const { execute: fetchRecordingList, isLoading: isListLoading } = useRecordingList()
const { execute: analyzeRecording, isLoading: isAnalyzing } = useAnalyzeRecording()
const { execute: updateProgress, isLoading: isUpdating } = useUpdateProgress()

// 评测 SDK
const {
  isLoading: isEvalLoading,
  initEngine,
  analyzeRecording: evalAnalyzeRecording,
  destroy: destroyEngine,
} = useSpeechEvaluation()

// 用户信息
const userStore = useUserStore()

// 本次录音（未保存，来自 VoiceRecorder）
const pendingRecording = ref<{ blob: Blob; duration: number } | null>(null)

// 来自 VoiceRecorder 的事件
function handleRecordingReady(data: { blob: Blob; duration: number }) {
  pendingRecording.value = data
}

function handleRecordingSaved() {
  pendingRecording.value = null
  loadRecordings()
}

// 点击"分析"按钮 — 使用 SDK 评测当前录音
async function handleRecordingAnalyze(data: { blob: Blob; duration: number; recording: { id: number } }) {
  if (isEvalLoading.value || isAnalyzing.value) return

  const userId = userStore.user?.id
  if (!userId) {
    toastError('用户信息异常，请重新登录')
    return
  }

  const { blob, recording: savedRecording } = data
  const refText = props.segment.textContent

  // 先销毁已有引擎（initEngine 有缓存，多次分析需重新初始化）
  destroyEngine()

  try {
    const authRes = await getEvaluationAuth()
    if (authRes?.code !== 200 || !authRes.data) {
      toastError(authRes?.message || '获取评测授权失败')
      return
    }

    const { warrantId, applicationId } = authRes.data

    await initEngine(applicationId, String(userId), warrantId)

    const result = await evalAnalyzeRecording(blob, refText)

    logger.info('[Dubbing] 评测结果:', result)

    // 保存评测结果到后端
    const saveRes = await analyzeRecording({
      id: savedRecording.id,
      sdkResult: result,
    })
    if (saveRes?.code === 200 && saveRes.data) {
      // 更新列表中的记录
      const idx = recordings.value.findIndex(r => r.id === saveRes.data!.id)
      if (idx !== -1) {
        recordings.value[idx] = saveRes.data
      }
      // 选中刚分析的录音
      selectedRecordingId.value = saveRes.data.id
    }

    // TODO: 保存结果到后端（留空）
  } catch (err) {
    const msg = err instanceof Error ? err.message : '评测请求失败'
    toastError(msg)
    logger.error('[Dubbing] 评测失败:', err)
  }
}

// UI 状态
const translationExpanded = ref(false)
const recordings = ref<Recording[]>([])
const totalRecordings = ref(0)
const selectedRecordingId = ref<number | null>(null)

// 是否还有更多历史记录
const hasMoreRecordings = computed(() =>
  recordings.value.length < totalRecordings.value
)

// 格式化时长
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 当前选中的录音
const selectedRecording = computed(() =>
  recordings.value.find(r => r.id === selectedRecordingId.value) || null
)
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

// 列表加载错误
const isListError = ref(false)
const listErrorMsg = ref('')

// 播放材料音频
async function playMaterialAudio() {
  if (!props.segment.audioUrl) return
  await loadAudio(props.segment.audioUrl)
  playAudio()
}

// 播放录音
async function playRecording() {
  if (!selectedRecording.value?.audioPath) return
  
  let url = selectedRecording.value.audioPath
  
  // 只有检测到不是 http/https 开头时，才处理成绝对路径（加 /）
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    // 如果本身不以 / 开头，则补上 /；避免出现双斜杠
    url = url.startsWith('/') ? url : `/${url}`
  }
  
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
    logger.error('分析请求失败:', err)
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

// 加载录音列表（第一页）
async function loadRecordings() {
  isListError.value = false
  listErrorMsg.value = ''
  try {
    const res = await fetchRecordingList({
      segmentId: props.segment.id,
      phase: 3,
      page: 1,
      size: 3,
    })
    if (res?.code === 200 && res.data) {
      recordings.value = res.data.items
      totalRecordings.value = res.data.total
    } else {
      isListError.value = true
      listErrorMsg.value = res?.message || '加载录音列表失败'
    }
  } catch (err) {
    logger.error('加载录音列表失败:', err)
    isListError.value = true
    listErrorMsg.value = '网络异常，加载录音列表失败'
  }
}

// 加载更多历史录音
const isListLoadingMore = ref(false)
async function loadMoreRecordings() {
  if (isListLoadingMore.value || !hasMoreRecordings.value) return
  isListLoadingMore.value = true
  try {
    const nextPage = Math.floor(recordings.value.length / 3) + 1
    const res = await fetchRecordingList({
      segmentId: props.segment.id,
      phase: 3,
      page: nextPage,
      size: 3,
    })
    if (res?.code === 200 && res.data) {
      recordings.value = [...recordings.value, ...res.data.items]
      totalRecordings.value = res.data.total
    }
  } catch (err) {
    logger.error('加载更多录音失败:', err)
  } finally {
    isListLoadingMore.value = false
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

    <!-- 卡片 3：历史录音列表 -->
    <div class="card">
      <div class="card__header">
        <span>历史录音</span>
        <span class="recording-count">{{ totalRecordings }} 条</span>
      </div>

      <div v-if="isListLoading" class="card__body empty-state">
        <DotPulse />
      </div>

      <div v-else-if="isListError" class="card__body empty-state">
        <p>{{ listErrorMsg }}</p>
        <button class="retry-btn retry-btn--small" @click="loadRecordings">重新加载</button>
      </div>

      <div v-else-if="recordings.length === 0" class="card__body empty-state">
        <p>还没有录音，点击下方按钮开始录制</p>
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

        <!-- 加载更多 -->
        <div v-if="hasMoreRecordings" class="load-more-wrap">
          <button
            class="load-more-btn"
            :disabled="isListLoadingMore"
            @click="loadMoreRecordings"
          >
            <template v-if="isListLoadingMore">
              <DotPulse />
            </template>
            <template v-else>
              查看更多（共 {{ totalRecordings }} 条）
            </template>
          </button>
        </div>

        <!-- 选中录音的操作按钮 -->
        <div v-if="selectedRecording" class="selected-actions">
          <button class="selected-action-btn" @click="playRecording">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放录音
          </button>
        </div>
      </div>
    </div>

    <!-- 卡片 4：AI 分析结果 -->
    <div class="card">
      <div class="card__header">AI 评分</div>

      <div v-if="!selectedRecording || !hasAnalysis" class="card__body empty-state">
        <p>选择一条录音并发起分析</p>
      </div>

      <div v-else class="analysis-result">
        <div class="score-section">
          <div class="score-number">{{ selectedRecording.score }}</div>
          <div class="score-label">综合评分</div>
          <div class="score-bar">
            <div class="score-bar__fill" :style="{ width: `${selectedRecording.score}%` }"></div>
          </div>
        </div>

        <div class="feedback-section">
          <div class="feedback-title">AI 评价</div>
          <p class="feedback-text">{{ selectedRecording.feedback }}</p>
        </div>

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

    <!-- 卡片 5：录音操作 -->
    <div class="card recording-card-bottom">
      <div class="card__header">录音</div>
      <VoiceRecorder
        :segment-id="segment.id"
        :phase="3"
        @recording-ready="handleRecordingReady"
        @recording-saved="handleRecordingSaved"
        @recording-analyze="handleRecordingAnalyze"
      />
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

.retry-btn--small {
  margin-top: 8px;
  padding: 6px 14px;
  font-size: 13px;
}

/* ===== 加载更多 ===== */
.load-more-wrap {
  text-align: center;
  padding-top: 8px;
}

.load-more-btn {
  padding: 6px 16px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.2s, opacity 0.2s;
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.load-more-btn:not(:disabled):active {
  background: var(--primary-light);
}

/* ===== 底部录音卡片 ===== */
.recording-card-bottom {
  position: fixed;
  bottom: 0;
  padding-bottom: 56px;
  width: 358px;
}
</style>
