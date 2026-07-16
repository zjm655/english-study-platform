<script setup lang="ts">
import { VideoPlay, Check, Upload } from '@element-plus/icons-vue'
import { useUnits, useUserProgress } from '~/composables/unit'
import type { UnitWithProgress, UserProgress } from '~~/shared/types/unit'

definePageMeta({
  title: '学习'
})

const { isLoading: unitsLoading, execute: fetchUnits } = useUnits()
const units = ref<UnitWithProgress[]>([])

const { isLoading: progressLoading, execute: fetchUserProgress } = useUserProgress()
const userProgress = ref<UserProgress | null>(null)

const dataReady = ref(false)

const isLoading = computed(() => unitsLoading.value || progressLoading.value)

const currentProgress = computed(() => {
  if (!userProgress.value?.details?.length) {
    const firstUnit = units.value[0]
    if (!firstUnit) return null
    return {
      unitTitle: firstUnit.title,
      segmentTitle: '开始学习',
      currentPhase: 1,
      phases: [
        { phase: 1, name: '盲听', done: false },
        { phase: 2, name: '学习', done: false },
        { phase: 3, name: '配音', done: false },
        { phase: 4, name: '跟读', done: false }
      ]
    }
  }

  const currentDetail = userProgress.value.details.find(
    (d) => !(d.phase1_done && d.phase2_done && d.phase3_done && d.phase4_done)
  )

  if (!currentDetail) {
    const lastDetail = userProgress.value.details[userProgress.value.details.length - 1]
    if (!lastDetail) return null
    return {
      unitTitle: lastDetail.unitTitle,
      segmentTitle: lastDetail.segmentTitle,
      currentPhase: 4,
      phases: [
        { phase: 1, name: '盲听', done: true },
        { phase: 2, name: '学习', done: true },
        { phase: 3, name: '配音', done: true },
        { phase: 4, name: '跟读', done: true }
      ]
    }
  }

  const phases = [
    { phase: 1, name: '盲听', done: currentDetail.phase1_done },
    { phase: 2, name: '学习', done: currentDetail.phase2_done },
    { phase: 3, name: '配音', done: currentDetail.phase3_done },
    { phase: 4, name: '跟读', done: currentDetail.phase4_done }
  ]

  return {
    unitTitle: currentDetail.unitTitle,
    segmentTitle: currentDetail.segmentTitle,
    currentPhase: phases.findIndex(p => !p.done) + 1,
    phases
  }
})

const progressPercent = computed(() => {
  if (!currentProgress.value) return 0
  const doneCount = currentProgress.value.phases.filter(p => p.done).length
  return (doneCount / 4) * 100
})

const continueText = computed(() => {
  if (!currentProgress.value) return '开始学习'
  const current = currentProgress.value.phases.find(p => !p.done)
  return current ? `继续${current.name}` : '已完成'
})

function getContinueLink() {
  if (!userProgress.value?.details?.length) {
    const firstUnit = units.value[0]
    return firstUnit ? `/learn/unit/${firstUnit.id}` : '/learn'
  }

  const currentDetail = userProgress.value.details.find(
    (d) => !(d.phase1_done && d.phase2_done && d.phase3_done && d.phase4_done)
  )

  if (currentDetail) {
    return `/learn/unit/${currentDetail.unitId}#segment-${currentDetail.segmentId}`
  }

  const lastDetail = userProgress.value.details[userProgress.value.details.length - 1]
  return lastDetail ? `/learn/unit/${lastDetail.unitId}` : '/learn'
}

async function initProgress() {
  const progressRes = await fetchUserProgress(null)
  if (progressRes?.code === 200) {
    userProgress.value = progressRes.data
  }
}

async function initUnits() {
  const unitsRes = await fetchUnits(undefined)
  if (unitsRes?.code === 200) {
    units.value = unitsRes.data || []
  }
  if (!isLoading.value)
    dataReady.value = true
}

async function initUser() {
  await initProgress()
  if (!isLoading.value)
    dataReady.value = true
}

onMounted(() => {
  initUser()
  initUnits()
})
</script>

<template>
  <div class="page-learn">
    <div v-if="isLoading || !dataReady" class="loading-container">
      <DotPulse />
    </div>

    <template v-else>
      <div class="progress-card" v-if="currentProgress">
        <div class="progress-header">
          <div class="progress-header__unit">{{ currentProgress.unitTitle }}</div>
          <div class="progress-header__segment">{{ currentProgress.segmentTitle }}</div>
        </div>

        <div class="phase-steps">
          <div
            v-for="item in currentProgress.phases"
            :key="item.phase"
            class="phase-step"
            :class="{
              'phase-step--done': item.done,
              'phase-step--current': !item.done && currentProgress.phases[currentProgress.phases.indexOf(item) - 1]?.done
            }"
          >
            <div class="phase-step__icon">
              <el-icon v-if="item.done"><Check /></el-icon>
              <span v-else>{{ item.phase }}</span>
            </div>
            <div class="phase-step__name">{{ item.name }}</div>
          </div>
        </div>

        <div class="progress-bar">
          <div class="progress-bar__fill" :style="{ width: progressPercent + '%' }"></div>
        </div>

        <NuxtLink :to="getContinueLink()" class="continue-btn">
          <el-icon><VideoPlay /></el-icon>
          <span>{{ continueText }}</span>
        </NuxtLink>
      </div>

      <div class="units-section">
        <div class="units-section__title">全部单元</div>
        <div class="unit-list" v-if="!unitsLoading && units.length">
          <NuxtLink
            v-for="unit in units"
            :key="unit.id"
            :to="`/learn/unit/${unit.id}`"
            class="unit-card"
          >
            <div class="unit-card__info">
              <div class="unit-card__title">{{ unit.title }}</div>
              <div class="unit-card__meta">{{ unit.progress.totalSegments }} 个片段</div>
            </div>
            <div class="unit-card__progress">
              <span class="unit-card__progress-text">{{ unit.progress.completedSegments }}/{{ unit.progress.totalSegments }}</span>
              <div class="unit-card__progress-bar">
                <div
                  class="unit-card__progress-fill"
                  :style="{ width: unit.progress.percent + '%' }"
                ></div>
              </div>
            </div>
          </NuxtLink>
        </div>
        <div v-else-if="unitsLoading" class="empty-state">加载中...</div>
        <div v-else class="empty-state">暂无单元数据</div>
      </div>

      <NuxtLink to="/learn/upload" class="upload-entry">
        <el-icon><Upload /></el-icon>
        <span>上传自定义材料</span>
      </NuxtLink>
    </template>
  </div>
</template>

<style scoped>
.page-learn {
  padding: 16px;
  min-height: 100%;
}

/* ========== 进度卡片 ========== */
.progress-card {
  background: var(--card);
  border-radius: var(--r-xl);
  padding: 20px;
  box-shadow: var(--shadow);
  margin-bottom: 24px;
}

.progress-header {
  margin-bottom: 16px;
}

.progress-header__unit {
  font-size: 14px;
  color: var(--text-3);
  margin-bottom: 4px;
}

.progress-header__segment {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-1);
}

/* ========== 四阶段步骤 ========== */
.phase-steps {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 0 8px;
}

.phase-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.phase-step__icon {
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

.phase-step--done .phase-step__icon {
  background: var(--success);
  color: #fff;
}

.phase-step--current .phase-step__icon {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.2);
}

.phase-step__name {
  font-size: 11px;
  color: var(--text-3);
}

.phase-step--done .phase-step__name,
.phase-step--current .phase-step__name {
  color: var(--text-1);
  font-weight: 500;
}

/* ========== 进度条 ========== */
.progress-bar {
  height: 4px;
  background: var(--border-ll);
  border-radius: 2px;
  margin-bottom: 16px;
  overflow: hidden;
}

.progress-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), #66b1ff);
  border-radius: 2px;
  transition: width 0.3s;
}

/* ========== 继续学习按钮 ========== */
.continue-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  background: var(--primary);
  border-radius: var(--r-m);
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  text-decoration: none;
  transition: opacity 0.2s;
}

.continue-btn:active {
  opacity: 0.85;
}

/* ========== 单元列表 ========== */
.units-section {
  margin-top: 4px;
}

.units-section__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 12px;
}

.unit-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.unit-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--card);
  border-radius: var(--r-l);
  box-shadow: var(--shadow);
  text-decoration: none;
  transition: transform 0.2s;
}

.unit-card:active {
  transform: scale(0.98);
}

.unit-card__info {
  flex: 1;
  min-width: 0;
}

.unit-card__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 4px;
}

.unit-card__meta {
  font-size: 12px;
  color: var(--text-3);
}

.unit-card__progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 60px;
}

.unit-card__progress-text {
  font-size: 12px;
  color: var(--text-3);
}

.unit-card__progress-bar {
  width: 60px;
  height: 4px;
  background: var(--border-ll);
  border-radius: 2px;
  overflow: hidden;
}

.unit-card__progress-fill {
  height: 100%;
  background: var(--success);
  border-radius: 2px;
  transition: width 0.3s;
}

/* ========== 空状态 & Loading ========== */
.empty-state {
  text-align: center;
  padding: 24px;
  font-size: 14px;
  color: var(--text-3);
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}

.upload-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
  padding: 12px 20px;
  background: var(--card);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow);
  color: var(--text-2);
  font-size: 14px;
  transition: color 0.2s, box-shadow 0.2s;
}

.upload-entry:hover {
  color: var(--primary);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>