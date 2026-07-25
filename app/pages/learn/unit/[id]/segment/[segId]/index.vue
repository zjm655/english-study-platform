<script setup lang="ts">
import { useSegmentDetail } from '~/composables/unit'
import type { SegmentDetail } from '~~/shared/types/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useAudioLifecycle } from '~/composables/media/useAudioLifecycle'
import { useStudyTimer } from '~/composables/user/useStudyTimer'
import { preloadEngineScript } from '~/composables/evaluation/useSpeechEvaluation'
import BlindListening from '~/components/phases/BlindListening.vue'
import TextLearning from '~/components/phases/TextLearning.vue'
import DubbingPractice from '~/components/phases/DubbingPractice.vue'
import ShadowReading from '~/components/phases/ShadowReading.vue'

definePageMeta({
  title: '片段学习',
})

useSeoMeta({
  title: '片段学习',
  description: '完成当前片段的盲听选择题、原文精学、AI 配音评分与影子跟读四阶段训练。',
})

const route = useRoute()
const segId = computed(() => Number(route.params.segId))
const unitId = computed(() => Number(route.params.id))

const { isLoading, fetchSegmentDetail } = useSegmentDetail()
const { play: _play, pause } = useAudioPlayer()

// 自动管理音频生命周期
useAudioLifecycle()

// 自动上报学习时长
useStudyTimer()

const segment = ref<SegmentDetail | null>(null)
const error = ref<string | null>(null)

// 当前阶段（1-4）
const currentPhase = ref(1)

// 阶段注册表：承载指示器文案 + 页眉文案 + 对应阶段组件
const phases = [
  {
    phase: 1,
    name: '盲听',
    title: '盲听理解',
    desc: '仔细听音频，理解大意后回答问题',
    component: BlindListening,
  },
  {
    phase: 2,
    name: '学习',
    title: '文本学习',
    desc: '对照原文学习，点击单词查看详情',
    component: TextLearning,
  },
  {
    phase: 3,
    name: '配音',
    title: '配音练习',
    desc: '跟随原文朗读，录制你的声音',
    component: DubbingPractice,
    spacer: true,
  },
  {
    phase: 4,
    name: '跟读',
    title: '影子跟读',
    desc: '跟随音频同步朗读，模仿语音语调',
    component: ShadowReading,
  },
]

// 当前激活阶段（驱动动态组件 + 页眉）
const activePhase = computed(() => phases.find((p) => p.phase === currentPhase.value)!)

async function loadData() {
  error.value = null
  const res = await fetchSegmentDetail(segId.value)
  if (res?.code === 200 && res.data) {
    segment.value = res.data
    // 不自动 load()，等用户点击播放时再加载（浏览器要求用户手势）
    // 根据进度设置当前阶段
    const progress = res.data.progress
    if (progress.phase1_done && progress.phase2_done && progress.phase3_done) {
      currentPhase.value = 4
    } else if (progress.phase1_done && progress.phase2_done) {
      currentPhase.value = 3
    } else if (progress.phase1_done) {
      currentPhase.value = 2
    } else {
      currentPhase.value = 1
    }
  } else {
    error.value = res?.message || '加载失败'
  }
}

onMounted(() => {
  loadData()
  // 预注入评测 SDK（368KB，已从全局 head 移除）：进页即开始下载，Phase 3/4 评测入口体感不变
  preloadEngineScript()
})

// 切换阶段（只允许跳转到已完成阶段或下一个待完成阶段）
function canNavigateTo(phase: number): boolean {
  if (!segment.value) return false
  // 已完成的阶段可以回看
  if (isPhaseDone(phase)) return true
  // 当前阶段可以进入
  if (phase === currentPhase.value) return true
  // 下一个待完成阶段可以进入
  const nextPhase = (() => {
    if (!segment.value!.progress.phase1_done) return 1
    if (!segment.value!.progress.phase2_done) return 2
    if (!segment.value!.progress.phase3_done) return 3
    return 4
  })()
  return phase === nextPhase
}

function goToPhase(phase: number) {
  if (phase >= 1 && phase <= 4 && canNavigateTo(phase)) {
    currentPhase.value = phase
    pause() // 切换阶段时暂停音频
  }
}

// 获取当前阶段的完成状态
function isPhaseDone(phase: number): boolean {
  if (!segment.value) return false
  const p = segment.value.progress
  switch (phase) {
    case 1:
      return p.phase1_done
    case 2:
      return p.phase2_done
    case 3:
      return p.phase3_done
    case 4:
      return p.phase4_done
    default:
      return false
  }
}

// 阶段完成回调
function onPhaseComplete() {
  loadData() // 重新加载数据以更新进度状态
}
</script>

<template>
  <div class="segment-page">
    <!-- Loading -->
    <div v-if="isLoading" class="loading-container">
      <DotPulse />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-container">
      <div class="error-text">{{ error }}</div>
      <button class="retry-btn" @click="loadData">重试</button>
    </div>

    <!-- Content -->
    <template v-else-if="segment">
      <!-- 面包屑 -->
      <nav class="breadcrumb" aria-label="面包屑导航">
        <NuxtLink :to="`/learn/unit/${unitId}`" class="breadcrumb__link">
          {{ segment.unitTitle }}
        </NuxtLink>
        <span class="breadcrumb__separator" aria-hidden="true">/</span>
        <span class="breadcrumb__current" aria-current="page">{{ segment.title }}</span>
      </nav>

      <!-- 阶段指示器 -->
      <div class="phase-indicator" role="tablist" aria-label="学习阶段">
        <div
          v-for="item in phases"
          :key="item.phase"
          class="phase-step"
          :class="{
            'phase-step--active': currentPhase === item.phase,
            'phase-step--done': isPhaseDone(item.phase),
            'phase-step--disabled': !canNavigateTo(item.phase),
          }"
          role="tab"
          :aria-selected="currentPhase === item.phase"
          :tabindex="canNavigateTo(item.phase) ? 0 : -1"
          @click="goToPhase(item.phase)"
          @keydown.enter.prevent="goToPhase(item.phase)"
        >
          <div class="phase-step__circle">
            <svg
              v-if="isPhaseDone(item.phase)"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
            <span v-else>{{ item.phase }}</span>
          </div>
          <div class="phase-step__name">{{ item.name }}</div>
        </div>
      </div>

      <!-- 音频播放器 -->
      <AudioPlayer :src="segment?.audioUrl" class="audio-player" />

      <!-- 阶段内容区 -->
      <div class="phase-content">
        <div class="phase-panel">
          <PhaseHeader :title="activePhase.title" :desc="activePhase.desc" />
          <component :is="activePhase.component" :segment="segment" @complete="onPhaseComplete" />
          <div v-if="activePhase.spacer" class="phase-panel__margin--phase3"></div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.segment-page {
  padding: 16px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

/* ===== Loading / Error ===== */
.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 16px;
}

.error-text {
  font-size: 14px;
  color: var(--text-3);
}

.retry-btn {
  padding: 10px 28px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--r);
  font-size: 14px;
  cursor: pointer;
}

/* ===== 面包屑 ===== */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 13px;
}

.breadcrumb__link {
  color: var(--primary);
  text-decoration: none;
}

.breadcrumb__separator {
  color: var(--text-3);
}

.breadcrumb__current {
  color: var(--text-2);
}

/* ===== 阶段指示器 ===== */
.phase-indicator {
  display: flex;
  justify-content: center;
  gap: 32px;
  padding: 16px;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  margin-bottom: 16px;
}

.phase-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.phase-step__circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  background: var(--border-ll);
  color: var(--text-3);
  transition:
    background 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}

.phase-step__circle svg {
  width: 18px;
  height: 18px;
}

.phase-step--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.phase-step--active .phase-step__circle {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.2);
}

.phase-step--done .phase-step__circle {
  background: var(--success);
  color: #fff;
}

.phase-step__name {
  font-size: 12px;
  color: var(--text-3);
}

.phase-step--active .phase-step__name {
  color: var(--primary);
  font-weight: 500;
}

/* ===== 音频播放器 ===== */
.audio-player {
  margin-bottom: 16px;
}

/* ===== 阶段内容区 ===== */
.phase-content {
  flex: 1;
  margin-bottom: 16px;
  display: flex;
  min-height: 0;
}

.phase-panel {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 20px;
  flex: 1;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
}

.phase-panel__placeholder {
  padding: 40px;
  text-align: center;
  background: var(--bg);
  border-radius: var(--r);
  color: var(--text-3);
  font-size: 14px;
}

.phase-panel__margin--phase3 {
  margin-bottom: 250px;
}
</style>
