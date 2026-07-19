<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useUploadRecording, useAnalyzeRecording, useRecordingList } from '~/composables/recording'
import type { SegmentDetail } from '~~/shared/types/unit'
import type { Recording } from '#shared/types/recording'
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

// 音频播放（材料音频 + 录音回放，共享全局 Howler）
const { load: loadAudio, play: playAudio, stop: stopAudio } = useAudioPlayer()

// API
const { execute: uploadRecording } = useUploadRecording()
const { execute: analyzeRecording } = useAnalyzeRecording()
const { execute: fetchRecordingList, isLoading: isListLoading } = useRecordingList()
const { execute: updateProgress, isLoading: isUpdating } = useUpdateProgress()

// 评测 SDK
const {
  initEngine,
  startRealtime,
  stopRealtime,
  getRecordedAudio,
  destroy: destroyEngine,
} = useSpeechEvaluation()

const userStore = useUserStore()

// ── 跟读控制状态机：idle → running（播放+跟读）→ evaluating（评测/入库）→ idle ──
type Stage = 'idle' | 'running' | 'evaluating'
const stage = ref<Stage>('idle')

const errorMsg = ref('')
// 是否允许手动结束（仅录音真正开始后才允许，避免引擎初始化期间误点）
const canStop = ref(false)

// ── 历史记录列表 ──
const recordings = ref<Recording[]>([])
const totalRecordings = ref(0)
const selectedRecordingId = ref<number | null>(null)
const isListError = ref(false)
const listErrorMsg = ref('')
const isListLoadingMore = ref(false)

// 停止相关的定时器（结束+5s、兜底最大超时）
let stopTimer: ReturnType<typeof setTimeout> | null = null
let maxTimer: ReturnType<typeof setTimeout> | null = null
let recordStartMs = 0
let stopped = false

function clearTimers() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
  if (maxTimer) { clearTimeout(maxTimer); maxTimer = null }
}

/** 停止录音（幂等）：手动点击、音频结束+5s 或兜底超时触发 */
function triggerStop() {
  if (stopped) return
  stopped = true
  canStop.value = false
  clearTimers()
  stopAudio()
  stopRealtime()
}

/** 音频播放结束 → 再等 5s → 停止录音 */
function onMaterialEnded() {
  if (stopped) return
  stopTimer = setTimeout(triggerStop, 5000)
}

/** 等待 audioDataCallback 组装完 ogg（isLast 与结果回流时序不定，短轮询） */
async function waitForRecordedAudio(timeoutMs = 1500): Promise<Blob | null> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const blob = getRecordedAudio()
    if (blob) return blob
    if (Date.now() - start > timeoutMs) return null
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function start() {
  if (stage.value === 'running' || stage.value === 'evaluating') return

  const userId = userStore.user?.id
  if (!userId) {
    toastError('用户信息异常，请重新登录')
    return
  }
  if (!props.segment.audioUrl) {
    toastError('该片段暂无音频，无法跟读')
    return
  }

  errorMsg.value = ''
  stopped = false
  canStop.value = false
  stage.value = 'running'

  const refText = props.segment.textContent

  // 每次开始前销毁旧引擎，避免缓存
  destroyEngine()

  try {
    const authRes = await getEvaluationAuth()
    if (authRes?.code !== 200 || !authRes.data) {
      throw new Error(authRes?.message || '获取评测授权失败')
    }
    const { warrantId, applicationId } = authRes.data

    await initEngine(applicationId, String(userId), warrantId)

    // 启动实时录音评测（不设 evalTime，手动停止）
    recordStartMs = Date.now()
    const resultPromise = startRealtime(refText, 'en.pred.score', warrantId)

    // 并行播放材料音频；播放结束 +5s 停止
    await loadAudio(props.segment.audioUrl, { onEnded: onMaterialEnded })
    playAudio()
    // 录音与播放均已启动，开放手动结束
    canStop.value = true

    // 兜底：音频时长 + 5s + 8s 缓冲，防 onEnded 未触发导致永不停止
    const maxMs = ((props.segment.duration ?? 60) + 5 + 8) * 1000
    maxTimer = setTimeout(triggerStop, maxMs)

    // 等待评测结果
    const result = await resultPromise
    stage.value = 'evaluating'

    // 收集录音（ogg）并走 Phase3 相同的后端管道入库
    const duration = Math.max(1, Math.round((Date.now() - recordStartMs) / 1000))
    const audioBlob = await waitForRecordedAudio()
    if (!audioBlob) {
      throw new Error('未能获取跟读录音数据，请重试')
    }

    const uploadRes = await uploadRecording({
      audioBlob,
      segmentId: props.segment.id,
      phase: 4,
      duration,
    })
    if (uploadRes?.code !== 200 || !uploadRes.data) {
      throw new Error(uploadRes?.message || '录音上传失败')
    }

    const saveRes = await analyzeRecording({
      id: uploadRes.data.id,
      result: {
        score: result.score,
        wordScores: result.wordScores,
        recognizedText: result.recognizedText,
        rawResult: result.rawResult,
      },
    })
    if (saveRes?.code === 200 && saveRes.data) {
      // analyze 接口返回的 audioPath 为 recording 表原始列（空），
      // 用上传接口返回的已签名 OSS 地址回填，保证列表内可即时播放
      const newRecording: Recording = { ...saveRes.data, audioPath: uploadRes.data.audioPath }
      // 分析成功：前插入历史列表并选中，评分卡片随即展示
      recordings.value.unshift(newRecording)
      totalRecordings.value++
      selectedRecordingId.value = newRecording.id
    }

    // 回到 idle，可再次跟读或完成
    stage.value = 'idle'
  } catch (err) {
    triggerStop()
    const msg = err instanceof Error ? err.message : '跟读评测失败'
    errorMsg.value = msg
    toastError(msg)
    logger.error('[ShadowReading] 评测失败:', err)
    stage.value = 'idle'
  }
}

// ── 历史列表相关 ──

// 是否还有更多历史记录
const hasMoreRecordings = computed(() =>
  recordings.value.length < totalRecordings.value
)

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

// 格式化时长
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 选中一条录音
function selectRecording(id: number) {
  selectedRecordingId.value = id
}

// 从已签名 URL 推断 Howler 格式提示：录音统一为 opus 编码，
// ogg 容器显式按 opus 门控，避免 Howler 默认按 vorbis 误判而报“加载失败”
function recordingFormat(url: string): string | undefined {
  const ext = (url.split('?')[0] ?? '').split('.').pop()?.toLowerCase()
  if (!ext) return undefined
  if (ext === 'ogg') return 'opus'
  if (/^(webm|wav|mp3|m4a|mp4|opus)$/.test(ext)) return ext
  return undefined
}

// 播放选中的录音（跟读进行中禁止，避免打断材料播放）
async function playRecording() {
  if (stage.value !== 'idle') return
  if (!selectedRecording.value?.audioPath) return

  let url = selectedRecording.value.audioPath
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = url.startsWith('/') ? url : `/${url}`
  }
  const format = recordingFormat(url)
  await loadAudio(url, format ? { format } : undefined)
  playAudio()
}

// 加载录音列表（第一页）
async function loadRecordings() {
  isListError.value = false
  listErrorMsg.value = ''
  try {
    const res = await fetchRecordingList({
      segmentId: props.segment.id,
      phase: 4,
      page: 1,
      size: 3,
    })
    if (res?.code === 200 && res.data) {
      recordings.value = res.data.items
      totalRecordings.value = res.data.total
    } else {
      isListError.value = true
      listErrorMsg.value = res?.message || '加载跟读记录失败'
    }
  } catch (err) {
    logger.error('加载跟读记录失败:', err)
    isListError.value = true
    listErrorMsg.value = '网络异常，加载跟读记录失败'
  }
}

// 加载更多历史录音
async function loadMoreRecordings() {
  if (isListLoadingMore.value || !hasMoreRecordings.value) return
  isListLoadingMore.value = true
  try {
    const nextPage = Math.floor(recordings.value.length / 3) + 1
    const res = await fetchRecordingList({
      segmentId: props.segment.id,
      phase: 4,
      page: nextPage,
      size: 3,
    })
    if (res?.code === 200 && res.data) {
      recordings.value = [...recordings.value, ...res.data.items]
      totalRecordings.value = res.data.total
    }
  } catch (err) {
    logger.error('加载更多跟读记录失败:', err)
  } finally {
    isListLoadingMore.value = false
  }
}

// 完成跟读
async function completePhase() {
  if (!canComplete.value || isUpdating.value) return
  const res = await updateProgress({
    segmentId: props.segment.id,
    phase: 4,
    done: true,
    score: bestScore.value!,
  })
  if (res?.code === 200) {
    emit('complete')
  }
}

onMounted(() => {
  loadRecordings()
})

onBeforeUnmount(() => {
  clearTimers()
  stopAudio()
})
</script>

<template>
  <div class="shadow-reading">
    <!-- 戴耳机提示 -->
    <div class="headphone-tip">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 1a9 9 0 00-9 9v7a3 3 0 003 3h1a1 1 0 001-1v-6a1 1 0 00-1-1H5v-2a7 7 0 0114 0v2h-2a1 1 0 00-1 1v6a1 1 0 001 1h1a3 3 0 003-3v-7a9 9 0 00-9-9z" />
      </svg>
      <span>请佩戴耳机，点击开始后跟随音频朗读（不展示原文）</span>
    </div>

    <!-- 卡片：历史跟读列表 -->
    <div class="card">
      <div class="card__header">
        <span>历史跟读</span>
        <span class="recording-count">{{ totalRecordings }} 条</span>
      </div>

      <div v-if="isListLoading" class="card__body empty-state">
        <DotPulse />
      </div>

      <div v-else-if="isListError" class="card__body empty-state">
        <p>{{ listErrorMsg }}</p>
        <button class="retry-btn--small" @click="loadRecordings">重新加载</button>
      </div>

      <div v-else-if="recordings.length === 0" class="card__body empty-state">
        <p>还没有跟读记录，点击下方按钮开始跟读</p>
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
          <button class="selected-action-btn" :disabled="stage !== 'idle'" @click="playRecording">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放录音
          </button>
        </div>
      </div>
    </div>

    <!-- 卡片：AI 评分 -->
    <div class="card">
      <div class="card__header">AI 评分</div>

      <div v-if="!selectedRecording || !hasAnalysis" class="card__body empty-state">
        <p>选择一条跟读记录查看评分</p>
      </div>

      <div v-else class="analysis-result-wrap">
        <EvaluationResultCard :recording="selectedRecording!" :reference-text="segment.textContent" />
      </div>
    </div>

    <!-- 卡片：跟读控制 -->
    <div class="card">
      <div class="card__header">影子跟读</div>

      <div class="stage-body">
        <button
          v-if="stage === 'idle'"
          class="start-btn"
          @click="start"
        >
          {{ recordings.length > 0 ? '再次跟读' : '开始跟读' }}
        </button>

        <div v-else class="running-state">
          <DotPulse />
          <p class="running-text">
            {{ stage === 'running' ? '正在播放材料，请跟读…' : '正在评测…' }}
          </p>
          <!-- 手动结束；若不点击则由“音频结束+5s / 兜底超时”自动结束 -->
          <button
            v-if="stage === 'running' && canStop"
            class="stop-btn"
            @click="triggerStop"
          >
            结束跟读
          </button>
        </div>

        <p v-if="errorMsg && stage === 'idle'" class="error-text">{{ errorMsg }}</p>
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
        完成跟读
      </template>
    </button>
  </div>
</template>

<style scoped>
.shadow-reading {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.headphone-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--primary-light);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 13px;
}

.headphone-tip svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
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

.card__body {
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.6;
}

/* ===== 历史列表 ===== */
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

.retry-btn--small {
  margin-top: 8px;
  padding: 6px 14px;
  font-size: 13px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--text-2);
  cursor: pointer;
}

/* ===== 跟读控制 ===== */
.stage-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  gap: 12px;
}

.start-btn {
  padding: 14px 40px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--r);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.start-btn:active {
  opacity: 0.9;
}

.running-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.running-text {
  font-size: 14px;
  color: var(--text-2);
  margin: 0;
}

.stop-btn {
  margin-top: 4px;
  padding: 10px 28px;
  background: var(--danger);
  color: #fff;
  border: none;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.stop-btn:active {
  opacity: 0.9;
}

.error-text {
  font-size: 13px;
  color: var(--danger);
  margin: 0;
  text-align: center;
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
</style>
