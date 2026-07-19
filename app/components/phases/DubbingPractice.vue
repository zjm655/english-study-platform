<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useRecordingHistory, useAnalyzeRecording } from '~/composables/recording'
import type { SegmentDetail } from '~~/shared/types/unit'
import type { UploadRecordingResult } from '#shared/types/recording'
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
  playRecording,
  loadRecordings,
  loadMoreRecordings,
} = useRecordingHistory(props.segment.id, 3)

// API
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

// 点击"分析"按钮 — 使用 SDK 评测当前录音
async function handleRecordingAnalyze(data: { blob: Blob; duration: number; recording: UploadRecordingResult }) {
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
      addRecording({ ...saveRes.data, audioPath: savedRecording.audioPath })
      // 清空本次录音卡片：置空 pending 并触发 VoiceRecorder remount
      pendingRecording.value = null
      recorderKey.value++
    }
  } catch (err) {
    // 失败分支不清空卡片，保留录音供重试
    const msg = err instanceof Error ? err.message : '评测请求失败'
    toastError(msg)
    logger.error('[Dubbing] 评测失败:', err)
  }
}

// UI 状态
const translationExpanded = ref(false)
// 底部录音卡片折叠状态
const recorderCollapsed = ref(false)
// VoiceRecorder remount key：分析成功后自增以清空本次录音卡片
const recorderKey = ref(0)

// 播放材料音频
async function playMaterialAudio() {
  if (!props.segment.audioUrl) return
  await loadAudio(props.segment.audioUrl)
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
      @select="selectRecording"
      @load-more="loadMoreRecordings"
      @retry="loadRecordings"
      @play="playRecording"
    />

    <!-- 卡片 4：AI 分析结果 -->
    <div class="card">
      <div class="card__header">AI 评分</div>

      <div v-if="!selectedRecording || !hasAnalysis" class="card__body empty-state">
        <p>选择一条录音并发起分析</p>
      </div>

      <div v-else class="analysis-result-wrap">
        <EvaluationResultCard :recording="selectedRecording!" :reference-text="segment.textContent" />
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
        <span>录音</span>
        <svg
          class="recorder-toggle-icon"
          :class="{ 'recorder-toggle-icon--collapsed': recorderCollapsed }"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
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

/* ===== 底部录音卡片（可折叠） ===== */
.recording-card-bottom {
  position: fixed;
  bottom: 0;
  padding-bottom: 56px;
  width: 358px;
}

.recording-card__header {
  cursor: pointer;
  user-select: none;
}

.recorder-toggle-icon {
  width: 18px;
  height: 18px;
  color: var(--text-3);
  transition: transform 0.2s;
}

.recorder-toggle-icon--collapsed {
  transform: rotate(180deg);
}

/* 折叠态：收起主体，仅留页眉小条 */
.recording-card-bottom--collapsed {
  padding-bottom: 12px;
}
</style>
