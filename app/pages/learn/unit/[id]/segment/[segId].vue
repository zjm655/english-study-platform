<script setup lang="ts">
import { useSegmentDetail } from '~/composables/unit'
import type { SegmentDetail } from '~~/shared/types/unit'
import { useAudioPlayer } from '~/composables/useAudioPlayer'

definePageMeta({
  title: '片段学习',
})

const route = useRoute()
const segId = computed(() => Number(route.params.segId))
const unitId = computed(() => Number(route.params.id))

const { isLoading, fetchSegmentDetail } = useSegmentDetail()
const { load, play, pause } = useAudioPlayer()

const segment = ref<SegmentDetail | null>(null)
const error = ref<string | null>(null)

// 当前阶段（1-4）
const currentPhase = ref(1)

// 阶段定义
const phases = [
  { phase: 1, name: '盲听' },
  { phase: 2, name: '学习' },
  { phase: 3, name: '配音' },
  { phase: 4, name: '跟读' },
]

async function loadData() {
  error.value = null
  const res = await fetchSegmentDetail(segId.value)
  if (res?.code === 200 && res.data) {
    segment.value = res.data
    // 加载音频
    if (res.data.audioUrl) {
      load(res.data.audioUrl)
    }
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
})

// 切换阶段
function goToPhase(phase: number) {
  if (phase >= 1 && phase <= 4) {
    currentPhase.value = phase
    pause() // 切换阶段时暂停音频
  }
}

// 获取当前阶段的完成状态
function isPhaseDone(phase: number): boolean {
  if (!segment.value) return false
  const p = segment.value.progress
  switch (phase) {
    case 1: return p.phase1_done
    case 2: return p.phase2_done
    case 3: return p.phase3_done
    case 4: return p.phase4_done
    default: return false
  }
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
      <div class="breadcrumb">
        <NuxtLink :to="`/learn/unit/${unitId}`" class="breadcrumb__link">
          {{ segment.unitTitle }}
        </NuxtLink>
        <span class="breadcrumb__separator">/</span>
        <span class="breadcrumb__current">{{ segment.title }}</span>
      </div>

      <!-- 阶段指示器 -->
      <div class="phase-indicator">
        <div
          v-for="item in phases"
          :key="item.phase"
          class="phase-step"
          :class="{
            'phase-step--active': currentPhase === item.phase,
            'phase-step--done': isPhaseDone(item.phase),
          }"
          @click="goToPhase(item.phase)"
        >
          <div class="phase-step__circle">
            <span v-if="isPhaseDone(item.phase)">✓</span>
            <span v-else>{{ item.phase }}</span>
          </div>
          <div class="phase-step__name">{{ item.name }}</div>
        </div>
      </div>

      <!-- 音频播放器 -->
      <AudioPlayer class="audio-player" />

      <!-- 阶段内容区 -->
      <div class="phase-content">
        <!-- 阶段一：盲听 -->
        <div v-if="currentPhase === 1" class="phase-panel">
          <div class="phase-panel__title">盲听理解</div>
          <div class="phase-panel__desc">仔细听音频，理解大意后回答问题</div>
          <!-- TODO: 理解题组件 -->
          <div class="phase-panel__placeholder">理解题区域（待开发）</div>
        </div>

        <!-- 阶段二：学习 -->
        <div v-else-if="currentPhase === 2" class="phase-panel">
          <div class="phase-panel__title">文本学习</div>
          <div class="phase-panel__desc">对照原文学习，点击单词查看详情</div>
          <!-- TODO: 文本展示 + 单词高亮 -->
          <div class="phase-panel__placeholder">文本区域（待开发）</div>
        </div>

        <!-- 阶段三：配音 -->
        <div v-else-if="currentPhase === 3" class="phase-panel">
          <div class="phase-panel__title">配音练习</div>
          <div class="phase-panel__desc">跟随原文朗读，录制你的声音</div>
          <!-- TODO: 配音组件 -->
          <div class="phase-panel__placeholder">配音区域（待开发）</div>
        </div>

        <!-- 阶段四：跟读 -->
        <div v-else-if="currentPhase === 4" class="phase-panel">
          <div class="phase-panel__title">影子跟读</div>
          <div class="phase-panel__desc">跟随音频同步朗读，模仿语音语调</div>
          <!-- TODO: 跟读组件 -->
          <div class="phase-panel__placeholder">跟读区域（待开发）</div>
        </div>
      </div>

      <!-- 底部导航 -->
      <div class="phase-nav">
        <button
          class="nav-btn"
          :disabled="currentPhase <= 1"
          @click="goToPhase(currentPhase - 1)"
        >
          上一阶段
        </button>
        <button
          class="nav-btn nav-btn--primary"
          :disabled="currentPhase >= 4"
          @click="goToPhase(currentPhase + 1)"
        >
          下一阶段
        </button>
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
  transition: all 0.2s;
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
}

.phase-panel {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 20px;
}

.phase-panel__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.phase-panel__desc {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 20px;
}

.phase-panel__placeholder {
  padding: 40px;
  text-align: center;
  background: var(--bg);
  border-radius: var(--r);
  color: var(--text-3);
  font-size: 14px;
}

/* ===== 底部导航 ===== */
.phase-nav {
  display: flex;
  gap: 12px;
}

.nav-btn {
  flex: 1;
  padding: 12px;
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  background: var(--card);
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nav-btn:not(:disabled):active {
  background: var(--bg);
}

.nav-btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.nav-btn--primary:not(:disabled):active {
  opacity: 0.9;
}
</style>
