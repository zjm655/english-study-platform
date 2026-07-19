<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useUploadRecording } from '~/composables/recording'
import { useAnalyzeRecording } from '~/composables/recording'
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

// 音频播放（材料音频，共享全局 Howler）
const { load: loadAudio, play: playAudio, stop: stopAudio } = useAudioPlayer()

// API
const { execute: uploadRecording } = useUploadRecording()
const { execute: analyzeRecording } = useAnalyzeRecording()
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

// ── 状态机：idle → running（播放+跟读）→ evaluating（评测/入库）→ done ──
type Stage = 'idle' | 'running' | 'evaluating' | 'done'
const stage = ref<Stage>('idle')

const resultRecording = ref<Recording | null>(null)
const errorMsg = ref('')

// 停止相关的定时器（结束+5s、兜底最大超时）
let stopTimer: ReturnType<typeof setTimeout> | null = null
let maxTimer: ReturnType<typeof setTimeout> | null = null
let recordStartMs = 0
let stopped = false

function clearTimers() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
  if (maxTimer) { clearTimeout(maxTimer); maxTimer = null }
}

/** 停止录音（幂等）：音频结束+5s 或兜底超时触发 */
function triggerStop() {
  if (stopped) return
  stopped = true
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
  resultRecording.value = null
  stopped = false
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
      resultRecording.value = saveRes.data
    }

    // 更新进度
    await updateProgress({
      segmentId: props.segment.id,
      phase: 4,
      done: true,
      score: result.score,
    })

    stage.value = 'done'
  } catch (err) {
    triggerStop()
    const msg = err instanceof Error ? err.message : '跟读评测失败'
    errorMsg.value = msg
    toastError(msg)
    logger.error('[ShadowReading] 评测失败:', err)
    stage.value = 'idle'
  }
}

function restart() {
  stage.value = 'idle'
  resultRecording.value = null
  errorMsg.value = ''
}

function finish() {
  emit('complete')
}

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

    <!-- 未开始 / 进行中 -->
    <div v-if="stage === 'idle' || stage === 'running' || stage === 'evaluating'" class="stage-body">
      <button
        v-if="stage === 'idle'"
        class="start-btn"
        @click="start"
      >
        开始跟读
      </button>

      <div v-else class="running-state">
        <DotPulse />
        <p class="running-text">
          {{ stage === 'running' ? '正在播放材料，请跟读…' : '正在评测…' }}
        </p>
      </div>
    </div>

    <!-- 结果 -->
    <template v-else-if="stage === 'done' && resultRecording">
      <div class="card">
        <div class="card__header">跟读评分</div>
        <EvaluationResultCard :recording="resultRecording" :reference-text="segment.textContent" />
      </div>

      <div class="result-actions">
        <button class="retry-btn" @click="restart">再试一次</button>
        <button class="complete-btn complete-btn--active" :disabled="isUpdating" @click="finish">
          <template v-if="isUpdating">
            <DotPulse />
          </template>
          <template v-else>
            完成跟读
          </template>
        </button>
      </div>
    </template>
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

.stage-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
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
}

.result-actions {
  display: flex;
  gap: 12px;
}

.retry-btn {
  flex: 1;
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--text-2);
  font-size: 15px;
  cursor: pointer;
}

.complete-btn {
  flex: 1;
  padding: 14px;
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.complete-btn--active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.complete-btn--active:not(:disabled):active {
  opacity: 0.9;
}
</style>
