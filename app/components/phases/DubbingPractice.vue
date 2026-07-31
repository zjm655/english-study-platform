<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useRecordingHistory, useRetryAnalyze } from '~/composables/recording'
import type { SegmentDetail } from '~~/shared/types/unit'
import type { Recording, UploadRecordingResult } from '#shared/types/recording'
import { toastError } from '~/utils/popup'
import { useUserStore } from '~/store/useUserStore'
import { useEvaluationPipeline } from '~/composables/evaluation/useEvaluationPipeline'
import { getGuestEvalQuota } from '~/api/guest'
import { resolveGuestAudioUrl } from '~/composables/media/useGuestAudio'

interface Props {
  segment: SegmentDetail
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'complete'): void
}>()

// 音频播放（材料 + 录音回放，共享全局 Howler）
const { load: loadAudio, play: playAudio } = useAudioPlayer()

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
} = useRecordingHistory(props.segment.id, 3)

// API
const { execute: retryAnalyze, isLoading: isRetrying } = useRetryAnalyze()
const { execute: updateProgress, isLoading: isUpdating } = useUpdateProgress()

// 评测流程（鉴权 + initEngine + 评测 + 保存/失败回退统一封装，离线全流程）
const pipeline = useEvaluationPipeline()

// 用户信息
const userStore = useUserStore()

// 游客配额状态（仅游客身份时有效）
const isGuest = computed(() => !userStore.user)
const guestQuotaExhausted = ref(false)
const guestQuotaLoading = ref(false)

// 游客身份时查询配音配额
async function fetchGuestQuota() {
  if (!isGuest.value) return
  guestQuotaLoading.value = true
  try {
    const res = await getGuestEvalQuota()
    if (res?.code === 200 && res.data) {
      const { used, limit } = res.data.dubbing
      guestQuotaExhausted.value = limit > 0 && used >= limit
    }
  } catch {
    // 静默处理，不影响正常使用
  } finally {
    guestQuotaLoading.value = false
  }
}

// 本次录音（未保存，来自 VoiceRecorder）
const pendingRecording = ref<{ blob: Blob; duration: number } | null>(null)

// 来自 VoiceRecorder 的事件
function handleRecordingReady(data: { blob: Blob; duration: number }) {
  pendingRecording.value = data
}

// 点击"分析"按钮 — 使用 SDK 评测当前录音（离线全流程委托 pipeline）
async function handleRecordingAnalyze(data: {
  blob: Blob
  duration: number
  recording: UploadRecordingResult
}) {
  if (pipeline.isLoading.value) return

  // 游客配额检查：超限则拦截（前端二次防护，服务端也有检查）
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

  const { blob, recording: savedRecording } = data

  const outcome = await pipeline.runOffline({
    getBlob: () => Promise.resolve(blob),
    refText: props.segment.textContent,
    userId,
    recordingId: savedRecording.id,
    audioPath: savedRecording.audioPath,
    duration: savedRecording.duration,
    createdAt: savedRecording.createdAt,
    segmentId: props.segment.id,
    phase: 3,
  })

  // 成功入库或标记失败后的录音都并入历史列表（失败项支持点击重试）；
  // audioPath 已由 pipeline 用上传接口的已签名地址回填，保证列表内可即时播放
  if (outcome.recording) addRecording(outcome.recording)
  // 清空本次录音卡片：置空 pending 并触发 VoiceRecorder remount
  pendingRecording.value = null
  recorderKey.value++

  if (!outcome.success) {
    toastError(`${outcome.errorMessage}，已加入历史列表，可点击重试`)
  } else if (isGuest.value) {
    // 评测成功后刷新配额（可能已用完）
    fetchGuestQuota()
  }
}

// UI 状态
const translationExpanded = ref(false)
// 底部录音卡片折叠状态
const recorderCollapsed = ref(false)
// VoiceRecorder remount key：分析成功后自增以清空本次录音卡片
const recorderKey = ref(0)
// 当前正在重试分析的录音 ID（用于禁用重试按钮 + 显示 loading）
const retryingId = ref<number | null>(null)

// 重试分析失败的历史录音
async function handleRetryAnalyze(recording: Recording) {
  if (isRetrying.value) return
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

// 播放材料音频
async function playMaterialAudio() {
  // 游客：通过 audioObjectKey 动态获取签名 URL
  const resolvedUrl = await resolveGuestAudioUrl(
    props.segment.audioUrl,
    props.segment.audioObjectKey,
    'material',
  )
  if (!resolvedUrl) {
    toastError('今日音频播放次数已用完，登录后可无限使用')
    return
  }
  await loadAudio(resolvedUrl)
  playAudio()
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

onMounted(() => {
  loadRecordings()
  // 游客身份时查询配额（决定是否显示"已用完"提示）
  if (isGuest.value) fetchGuestQuota()
})
</script>

<template>
  <div class="dubbing-practice">
    <!-- 游客配额用完提示 -->
    <div v-if="isGuest && guestQuotaExhausted" class="quota-exhausted-banner">
      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
      <span>今日体验次数已用完，<a href="/login">登录</a>后可无限使用</span>
    </div>

    <!-- 卡片 1：原文 -->
    <div class="card">
      <div class="card__header">
        <span>原文</span>
        <button v-if="segment.audioUrl || segment.audioObjectKey" class="material-play-btn" @click="playMaterialAudio">
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
      <div
        class="card__header card__header--clickable"
        @click="translationExpanded = !translationExpanded"
      >
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
    <RecordingHistoryList
      :recordings="recordings"
      :total="totalRecordings"
      :selected-id="selectedRecordingId"
      :is-loading="isListLoading"
      :is-error="isListError"
      :error-msg="listErrorMsg"
      :has-more="hasMoreRecordings"
      :is-loading-more="isListLoadingMore"
      title="历史录音"
      empty-text="还没有录音，点击下方按钮开始录制"
      :retrying-id="retryingId"
      @select="selectRecording"
      @load-more="loadMoreRecordings"
      @retry="loadRecordings"
      @play="playRecording"
      @retry-analyze="handleRetryAnalyze"
    />

    <!-- 卡片 4：AI 分析结果 -->
    <div class="card">
      <div class="card__header">AI 评分</div>

      <div v-if="!selectedRecording || !hasAnalysis" class="card__body empty-state">
        <p>选择一条录音并发起分析</p>
      </div>

      <div v-else class="analysis-result-wrap">
        <EvaluationResultCard :recording="selectedRecording!" />
      </div>
    </div>

    <!-- 卡片 5：录音操作（可折叠） -->
    <div
      class="card recording-card-bottom"
      :class="{ 'recording-card-bottom--collapsed': recorderCollapsed }"
    >
      <div
        class="card__header recording-card__header"
        @click="recorderCollapsed = !recorderCollapsed"
      >
        <span class="recording-card__title">🎙️ 录音</span>
        <span class="recorder-toggle-hint">
          {{ recorderCollapsed ? '展开' : '收起' }}
          <svg
            class="recorder-toggle-icon"
            :class="{ 'recorder-toggle-icon--collapsed': recorderCollapsed }"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </div>
      <div v-show="!recorderCollapsed" class="recording-card__body">
        <VoiceRecorder
          :key="recorderKey"
          :segment-id="segment.id"
          :phase="3"
          @recording-ready="handleRecordingReady"
          @recording-analyze="handleRecordingAnalyze"
        />
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
      <template v-else> 完成配音 </template>
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
  transition:
    background 0.2s,
    color 0.2s,
    border-color 0.2s;
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
.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--text-3);
  font-size: 13px;
}

/* ===== 分析结果卡片（内容已抽出至 EvaluationResultCard） ===== */

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

/* ===== 底部录音卡片（可折叠） ===== */
/* 修复：卡片坐在 56px 高的 Footer 上方（bottom:60px）并水平居中，
   避免折叠后被 position:fixed / z-index:100 的 Footer 遮盖而不可见 */
.recording-card-bottom {
  position: fixed;
  bottom: 60px;
  left: 0;
  right: 0;
  margin: 0 auto;
  width: 358px;
  max-width: calc(100vw - 32px);
  z-index: 90;
  background: var(--card);
  box-shadow: var(--shadow);
}

/* 醒目的可点击页眉条 */
.recording-card__header {
  cursor: pointer;
  user-select: none;
  padding: 8px 12px;
  background: var(--primary-light);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  transition: background 0.2s;
}

.recording-card__header:active {
  background: #d9ecff;
}

.recording-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}

.recorder-toggle-hint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 500;
  color: var(--primary);
}

.recorder-toggle-icon {
  width: 16px;
  height: 16px;
  color: var(--primary);
  transition: transform 0.2s;
}

.recorder-toggle-icon--collapsed {
  transform: rotate(180deg);
}

/* 折叠态：主体隐藏，仅留醒目页眉条，收紧内边距 */
.recording-card-bottom--collapsed {
  padding: 12px;
}
</style>
