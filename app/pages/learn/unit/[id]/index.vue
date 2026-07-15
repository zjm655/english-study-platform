<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'
import { useUnitProgress } from '~/composables/unit'
import type { UnitProgressDetail } from '#shared/types/unit'

definePageMeta({
  title: '单元详情',
})

const route = useRoute()
const unitId = computed(() => Number(route.params.id))

const { isLoading, fetchUnitProgress } = useUnitProgress()

const unitData = ref<UnitProgressDetail['unit'] | null>(null)
const segments = ref<UnitProgressDetail['segments']>([])
const error = ref<string | null>(null)

async function loadData() {
  error.value = null
  const res = await fetchUnitProgress(unitId.value)
  if (res?.code === 200 && res.data) {
    unitData.value = res.data.unit
    segments.value = res.data.segments
  } else {
    error.value = res?.message || '加载失败'
  }
}

onMounted(() => {
  loadData()
})

function getSegmentPhases(segment: UnitProgressDetail['segments'][number]) {
  return [
    { phase: 1, name: '盲听', done: segment.progress.phase1_done },
    { phase: 2, name: '学习', done: segment.progress.phase2_done },
    { phase: 3, name: '配音', done: segment.progress.phase3_done },
    { phase: 4, name: '跟读', done: segment.progress.phase4_done },
  ]
}

function getCurrentPhaseIndex(phases: { done: boolean }[]) {
  return phases.findIndex((p) => !p.done)
}
</script>

<template>
  <div class="unit-detail-page">
    <!-- Loading -->
    <div v-if="isLoading" class="loading-container">
      <DotPulse />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-container">
      <div class="error-text">{{ error }}</div>
      <button class="retry-btn" @click="loadData">重试</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!segments.length" class="empty-state">
      暂无片段数据
    </div>

    <!-- Content -->
    <template v-else>
      <div class="unit-header">
        <h2 class="unit-header__title">{{ unitData?.title }}</h2>
        <p v-if="unitData?.description" class="unit-header__desc">{{ unitData.description }}</p>
      </div>

      <div class="segment-list">
        <NuxtLink
          v-for="segment in segments"
          :key="segment.id"
          :to="`/learn/unit/${unitId}/segment/${segment.id}`"
          class="segment-card"
        >
          <div class="segment-card__title">{{ segment.title }}</div>
          <div class="segment-card__phases">
            <div
              v-for="(item, idx) in getSegmentPhases(segment)"
              :key="item.phase"
              class="phase-dot"
              :class="{
                'phase-dot--done': item.done,
                'phase-dot--current': !item.done && getCurrentPhaseIndex(getSegmentPhases(segment)) === idx,
              }"
            >
              <div class="phase-dot__icon">
                <el-icon v-if="item.done"><Check /></el-icon>
                <span v-else>{{ item.phase }}</span>
              </div>
              <div class="phase-dot__name">{{ item.name }}</div>
            </div>
          </div>
        </NuxtLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.unit-detail-page {
  padding: 16px;
  min-height: 100%;
}

/* ===== 单元标题 ===== */
.unit-header {
  margin-bottom: 20px;
}

.unit-header__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 4px;
}

.unit-header__desc {
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.5;
}

/* ===== Loading ===== */
.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}

/* ===== Error ===== */
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
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
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.retry-btn:active {
  opacity: 0.85;
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 24px;
  font-size: 14px;
  color: var(--text-3);
}

/* ===== 片段卡片列表 ===== */
.segment-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.segment-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  text-decoration: none;
  transition: transform 0.2s;
}

.segment-card:active {
  transform: scale(0.98);
}

.segment-card__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
}

/* ===== 四阶段进度圆点 ===== */
.segment-card__phases {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 0 8px;
}

.phase-dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.phase-dot__icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--border-ll);
  color: var(--text-3);
  transition: all 0.3s;
}

.phase-dot--done .phase-dot__icon {
  background: var(--success);
  color: #fff;
}

.phase-dot--current .phase-dot__icon {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.2);
}

.phase-dot__name {
  font-size: 11px;
  color: var(--text-3);
}

.phase-dot--done .phase-dot__name,
.phase-dot--current .phase-dot__name {
  color: var(--text-1);
  font-weight: 500;
}
</style>