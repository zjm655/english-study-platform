<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useRecorder } from '~/composables/media/useRecorder'
import { useUploadRecording, useRetryAnalyze, useRecordingHistory } from '~/composables/recording'
import type { SegmentDetail } from '~~/shared/types/unit'
import type { Recording, UploadRecordingResult } from '#shared/types/recording'
import { toastError } from '~/utils/popup'
import { useUserStore } from '~/store/useUserStore'
import { useSpeechEvaluation } from '~/composables/evaluation/useSpeechEvaluation'
import { useEvaluationPipeline } from '~/composables/evaluation/useEvaluationPipeline'
import { resolveGuestAudioUrl } from '~/composables/media/useGuestAudio'
import { getGuestEvalQuota } from '~/api/guest'

interface Props {
  segment: SegmentDetail
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'complete'): void
}>()

// 音频播放（材料音频 + 录音回放，共享全局 Howler）
const { load: loadAudio, play: playAudio, stop: stopAudio } = useAudioPlayer()

// 录音历史列表（Phase3/4 共享逻辑）
const {
  recordings,
  totalRecordings,
  selectedRecordingId,
  isListLoading,
  isListError,
  listErrorMsg,
  isListLoadingMore,
  hasMoreRecordings,
  selectedRecording,
  hasAnalysis,
  bestScore,
  canComplete,
  selectRecording,
  addRecording,
  updateRecording,
  playRecording,
  loadRecordings,
  loadMoreRecordings,
} = useRecordingHistory(props.segment.id, 4)

// API
const { execute: uploadRecording } = useUploadRecording()
const { execute: retryAnalyze, isLoading: isRetrying } = useRetryAnalyze()
const { execute: updateProgress, isLoading: isUpdating } = useUpdateProgress()

// 评测流程（鉴权 + 保存/失败回退统一封装；实时评测的 initEngine/startRealtime 仍走本组件自有引擎）
const pipeline = useEvaluationPipeline()

// 评测 SDK
const {
  initEngine,
  startRealtime,
  stopRealtime,
  getRecordedAudio,
  destroy: destroyEngine,
} = useSpeechEvaluation()

// 浏览器端录音（MediaRecorder → webm，可播放）：SDK 返回的是 Ogg-Speex，浏览器无法播放，
// 因此改用浏览器自行录制用于保存/回放，SDK 录音仅用于评测
const { start: startRecorder, stop: stopRecorder, isRecording: isRecorderActive } = useRecorder()
let recorderStopPromise: Promise<Blob | null> | null = null

const userStore = useUserStore()

// 游客配额状态（仅游客身份时有效）
const isGuest = computed(() => !userStore.user)
const guestQuotaExhausted = ref(false)

// 游客身份时查询影子跟读配额
async function fetchGuestQuota() {
  if (!isGuest.value) return
  try {
    const res = await getGuestEvalQuota()
    if (res?.code === 200 && res.data) {
      const { used, limit } = res.data.shadow
      guestQuotaExhausted.value = limit > 0 && used >= limit
    }
  } catch {
    // 静默处理，不影响正常使用
  }
}

// ── 跟读控制状态机：idle → running（播放+跟读）→ evaluating（评测/入库）→ idle ──
type Stage = 'idle' | 'running' | 'evaluating'
const stage = ref<Stage>('idle')

// 当前正在重试分析的录音 ID（用于禁用重试按钮 + 显示 loading）
const retryingId = ref<number | null>(null)

const errorMsg = ref('')
// 是否允许手动结束（仅录音真正开始后才允许，避免引擎初始化期间误点）
const canStop = ref(false)

// 停止相关的定时器（结束+5s、兜底最大超时）
let stopTimer: ReturnType<typeof setTimeout> | null = null
let maxTimer: ReturnType<typeof setTimeout> | null = null
let recordStartMs = 0
let stopped = false

function clearTimers() {
  if (stopTimer) {
    clearTimeout(stopTimer)
    stopTimer = null
  }
  if (maxTimer) {
    clearTimeout(maxTimer)
    maxTimer = null
  }
}

/** 停止录音（幂等）：手动点击、音频结束+5s 或兜底超时触发 */
function triggerStop() {
  if (stopped) return
  stopped = true
  canStop.value = false
  clearTimers()
  stopAudio()
  stopRealtime()
  // 停止浏览器端录音并暂存 blob promise，供 start() 收尾时 await
  if (isRecorderActive.value && !recorderStopPromise) {
    recorderStopPromise = stopRecorder().catch((e) => {
      logger.warn('[ShadowReading] 停止浏览器录音失败:', e)
      return null
    })
  }
}

/** 音频播放结束 → 再等 5s → 停止录音 */
function onMaterialEnded() {
  if (stopped) return
  stopTimer = setTimeout(triggerStop, 5000)
}

/** 等待 audioDataCallback 组装完 ogg（isLast 与结果回流时序不定，短轮询） */
async function waitForRecordedAudio(timeoutMs = 1500): Promise<Blob | null> {
  const start = Date.now()

  while (true) {
    const blob = getRecordedAudio()
    if (blob) return blob
    if (Date.now() - start > timeoutMs) return null
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function start() {
  if (stage.value === 'running' || stage.value === 'evaluating') return

  // 游客配额检查：超限则拦截
  if (isGuest.value && guestQuotaExhausted.value) {
    toastError('今日体验次数已用完，登录后可无限使用')
    return
  }

  // 登录用户需要有效 userId；游客用 0 占位（服务端从 guest_token 解析真实 id）
  const userId = userStore.user?.id ?? (isGuest.value ? 0 : null)
  if (userId === null) {
    toastError('用户信息异常，请重新登录')
    return
  }
  if (!props.segment.audioUrl && !props.segment.audioObjectKey) {
    toastError('该片段暂无音频，无法跟读')
    return
  }

  // 解析音频 URL：登录用户直接使用，游客通过 objectKey 动态获取
  const audioUrl = await resolveGuestAudioUrl(
    props.segment.audioUrl,
    props.segment.audioObjectKey,
    'material',
  )
  if (!audioUrl) {
    toastError('今日音频播放次数已用完，登录后可无限使用')
    return
  }

  errorMsg.value = ''
  stopped = false
  canStop.value = false
  recorderStopPromise = null
  stage.value = 'running'

  const refText = props.segment.textContent

  // 每次开始前销毁旧引擎，避免缓存
  destroyEngine()

  // 上传成功后暂存上传结果，供随后的 pipeline.saveEvaluation 使用
  let uploadedRecording: UploadRecordingResult | null = null

  try {
    const { warrantId, applicationId } = await pipeline.resolveAuth(4)

    await initEngine(applicationId, String(userId), warrantId)

    // 启动浏览器端录音（webm，可播放），与 SDK 评测并行
    await startRecorder()

    // 启动实时录音评测（不设 evalTime，手动停止）
    recordStartMs = Date.now()
    const resultPromise = startRealtime(refText, 'en.pred.score', warrantId)

    // 并行播放材料音频；播放结束 +5s 停止
    await loadAudio(audioUrl, { onEnded: onMaterialEnded })
    playAudio()
    // 录音与播放均已启动，开放手动结束
    canStop.value = true

    // 兜底：音频时长 + 5s + 8s 缓冲，防 onEnded 未触发导致永不停止
    const maxMs = ((props.segment.duration ?? 60) + 5 + 8) * 1000
    maxTimer = setTimeout(triggerStop, maxMs)

    // 等待评测结果
    const result = await resultPromise
    stage.value = 'evaluating'

    // 收集浏览器录音（webm，可播放）并走 Phase3 相同的后端管道入库
    if (!recorderStopPromise) {
      recorderStopPromise = stopRecorder().catch(() => null)
    }
    const duration = Math.max(1, Math.round((Date.now() - recordStartMs) / 1000))
    let audioBlob = await recorderStopPromise
    if (!audioBlob) {
      // 极端情况下浏览器录音不可用，回退 SDK 返回的音频（保证评分仍可入库）
      audioBlob = await waitForRecordedAudio()
    }
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
    uploadedRecording = uploadRes.data

    // 公共尾段：保存评测结果（成功回填 audioPath；失败标记 + 回退，杜绝"幽灵录音"）
    const outcome = await pipeline.saveEvaluation({
      recordingId: uploadedRecording.id,
      audioPath: uploadedRecording.audioPath,
      duration: uploadedRecording.duration,
      createdAt: uploadedRecording.createdAt,
      segmentId: props.segment.id,
      phase: 4,
      userId,
      result,
    })
    if (outcome.recording) addRecording(outcome.recording)
    if (!outcome.success) toastError(`${outcome.errorMessage}，已加入历史列表，可点击重试`)
    else if (isGuest.value) fetchGuestQuota() // 评测成功后刷新配额

    // 回到 idle，可再次跟读或完成
    stage.value = 'idle'
  } catch (err) {
    triggerStop()
    const msg = err instanceof Error ? err.message : '跟读评测失败'
    errorMsg.value = msg
    logger.error('[ShadowReading] 评测失败:', err)
    // 走到这里说明错误发生在保存之前（鉴权/初始化/录音/实时评测/上传）——
    // 上传成功后紧接的 pipeline.saveEvaluation 已在内部处理保存失败的标记与回退、不会抛出，
    // 故此处 uploadedRecording 尚未落库成功，无需重复标记，仅提示错误即可。
    toastError(msg)
    stage.value = 'idle'
  }
}

// 重试分析失败的历史跟读录音
async function handleRetryAnalyze(recording: Recording) {
  if (isRetrying.value) return
  // 跟读进行中不允许重试（避免与实时评测冲突）
  if (stage.value !== 'idle') return
  retryingId.value = recording.id
  try {
    const updated = await retryAnalyze({
      recording,
      refText: props.segment.textContent,
    })
    if (updated) {
      updateRecording(recording.id, updated)
    }
  } finally {
    retryingId.value = null
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
  // 游客身份时查询配额（决定是否显示"已用完"提示）
  if (isGuest.value) fetchGuestQuota()
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
        <path
          d="M12 1a9 9 0 00-9 9v7a3 3 0 003 3h1a1 1 0 001-1v-6a1 1 0 00-1-1H5v-2a7 7 0 0114 0v2h-2a1 1 0 00-1 1v6a1 1 0 001 1h1a3 3 0 003-3v-7a9 9 0 00-9-9z"
        />
      </svg>
      <span>请佩戴耳机，点击开始后跟随音频朗读（不展示原文）</span>
    </div>

    <!-- 游客配额用完提示 -->
    <div v-if="isGuest && guestQuotaExhausted" class="quota-exhausted-banner">
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
      <span>今日体验次数已用完，<a href="/login">登录</a>后可无限使用</span>
    </div>

    <!-- 卡片：历史跟读列表 -->
    <RecordingHistoryList
      :recordings="recordings"
      :total="totalRecordings"
      :selected-id="selectedRecordingId"
      :is-loading="isListLoading"
      :is-error="isListError"
      :error-msg="listErrorMsg"
      :has-more="hasMoreRecordings"
      :is-loading-more="isListLoadingMore"
      title="历史跟读"
      empty-text="还没有跟读记录，点击下方按钮开始跟读"
      :play-disabled="stage !== 'idle'"
      :retrying-id="retryingId"
      @select="selectRecording"
      @load-more="loadMoreRecordings"
      @retry="loadRecordings"
      @play="playRecording"
      @retry-analyze="handleRetryAnalyze"
    />

    <!-- 卡片：AI 评分 -->
    <div class="card">
      <div class="card__header">AI 评分</div>

      <div v-if="!selectedRecording || !hasAnalysis" class="card__body empty-state">
        <p>选择一条跟读记录查看评分</p>
      </div>

      <div v-else class="analysis-result-wrap">
        <EvaluationResultCard :recording="selectedRecording!" />
      </div>
    </div>

    <!-- 卡片：跟读控制 -->
    <div class="card">
      <div class="card__header">影子跟读</div>

      <div class="stage-body">
        <button v-if="stage === 'idle'" class="start-btn" @click="start">
          {{ recordings.length > 0 ? '再次跟读' : '开始跟读' }}
        </button>

        <div v-else class="running-state">
          <DotPulse />
          <p class="running-text">
            {{ stage === 'running' ? '正在播放材料，请跟读…' : '正在评测…' }}
          </p>
          <!-- 手动结束；若不点击则由“音频结束+5s / 兜底超时”自动结束 -->
          <button v-if="stage === 'running' && canStop" class="stop-btn" @click="triggerStop">
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
      <template v-else> 完成跟读 </template>
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

/* ===== 游客配额用完提示 ===== */
.quota-exhausted-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(245, 108, 108, 0.08);
  border: 1px solid rgba(245, 108, 108, 0.2);
  border-radius: var(--r);
  font-size: 13px;
  color: var(--danger);
}

.quota-exhausted-banner svg {
  flex-shrink: 0;
}

.quota-exhausted-banner a {
  color: var(--primary);
  text-decoration: none;
}

.quota-exhausted-banner a:active {
  opacity: 0.7;
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
.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--text-3);
  font-size: 13px;
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
  transition:
    background 0.2s,
    border-color 0.2s,
    color 0.2s,
    opacity 0.2s;
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
