<script setup lang="ts">
import { Sunny, VideoPlay, Check } from '@element-plus/icons-vue'
import { useUserStore } from '~/store/useUserStore'
definePageMeta({
  title: '首页',
  isHome: true
})

const userStore = useUserStore()
const user = computed(() => userStore.user)

// 问候语
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

// 模拟当前学习进度（后续从API获取）
const currentProgress = ref({
  unitTitle: 'Unit 1: Daily Conversation',
  segmentTitle: 'A Morning Routine',
  currentPhase: 1, // 当前在阶段2
  phases: [
    { phase: 1, name: '盲听', done: true },
    { phase: 2, name: '学习', done: false },
    { phase: 3, name: '配音', done: false },
    { phase: 4, name: '跟读', done: false }
  ]
})

// 模拟单元列表（后续从API获取）
const units = ref([
  { id: 1, title: 'Daily Conversation', segmentCount: 5, completedCount: 0 },
  { id: 2, title: 'School Life', segmentCount: 4, completedCount: 0 },
  { id: 3, title: 'Travel Abroad', segmentCount: 6, completedCount: 0 }
])

// 进度百分比
const progressPercent = computed(() => {
  const doneCount = currentProgress.value.phases.filter(p => p.done).length
  return (doneCount / 4) * 100
})

// 继续学习按钮文案
const continueText = computed(() => {
  const current = currentProgress.value.phases.find(p => !p.done)
  return current ? `继续${current.name}` : '已完成'
})
</script>

<template>
  <div class="home-page">
    <!-- 顶部问候 -->
    <div class="greeting-section">
      <div class="greeting-text">
        <ClientOnly>
          {{ greeting }}，{{ user?.nickname || '学习者' }}
        </ClientOnly>
      </div>
      <div class="streak-badge" v-if="user?.streakDays">
        <el-icon><Sunny /></el-icon>
        <span>
          <ClientOnly>
            连续 {{ user.streakDays }} 天
          </ClientOnly>
        </span>
      </div>
    </div>

    <!-- 当前学习进度卡片 -->
    <div class="progress-card">
      <div class="progress-header">
        <div class="unit-name">{{ currentProgress.unitTitle }}</div>
        <div class="segment-name">{{ currentProgress.segmentTitle }}</div>
      </div>

      <!-- 四阶段进度 -->
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
          <div class="phase-icon">
            <el-icon v-if="item.done"><Check /></el-icon>
            <span v-else>{{ item.phase }}</span>
          </div>
          <div class="phase-name">{{ item.name }}</div>
        </div>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar">
        <div class="progress-bar__fill" :style="{ width: progressPercent + '%' }"></div>
      </div>

      <!-- 继续学习按钮 -->
      <NuxtLink to="/learn" class="continue-btn">
        <el-icon><VideoPlay /></el-icon>
        <span>{{ continueText }}</span>
      </NuxtLink>
    </div>

    <!-- 单元列表 -->
    <div class="units-section">
      <div class="section-title">全部单元</div>
      <div class="unit-list">
        <NuxtLink
          v-for="unit in units"
          :key="unit.id"
          :to="`/learn/unit/${unit.id}`"
          class="unit-card"
        >
          <div class="unit-info">
            <div class="unit-title">{{ unit.title }}</div>
            <div class="unit-meta">{{ unit.segmentCount }} 个片段</div>
          </div>
          <div class="unit-progress">
            <span class="unit-progress__text">{{ unit.completedCount }}/{{ unit.segmentCount }}</span>
            <div class="unit-progress__bar">
              <div
                class="unit-progress__fill"
                :style="{ width: (unit.completedCount / unit.segmentCount * 100) + '%' }"
              ></div>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  padding: 16px;
  min-height: 100%;
}

/* 问候区域 */
.greeting-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.greeting-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
}

.streak-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: linear-gradient(135deg, #ff6b35, #ff8c42);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}

.streak-badge .el-icon {
  font-size: 14px;
}

/* 进度卡片 */
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

.unit-name {
  font-size: 14px;
  color: var(--text-3);
  margin-bottom: 4px;
}

.segment-name {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-1);
}

/* 四阶段步骤 */
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

.phase-icon {
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

.phase-step--done .phase-icon {
  background: var(--success);
  color: #fff;
}

.phase-step--current .phase-icon {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.2);
}

.phase-name {
  font-size: 11px;
  color: var(--text-3);
}

.phase-step--done .phase-name,
.phase-step--current .phase-name {
  color: var(--text-1);
  font-weight: 500;
}

/* 进度条 */
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

/* 继续学习按钮 */
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

/* 单元列表 */
.units-section {
  margin-top: 4px;
}

.section-title {
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

.unit-info {
  flex: 1;
  min-width: 0;
}

.unit-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 4px;
}

.unit-meta {
  font-size: 12px;
  color: var(--text-3);
}

.unit-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 60px;
}

.unit-progress__text {
  font-size: 12px;
  color: var(--text-3);
}

.unit-progress__bar {
  width: 60px;
  height: 4px;
  background: var(--border-ll);
  border-radius: 2px;
  overflow: hidden;
}

.unit-progress__fill {
  height: 100%;
  background: var(--success);
  border-radius: 2px;
  transition: width 0.3s;
}
</style>
