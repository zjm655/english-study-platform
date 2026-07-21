<script setup lang="ts">
import { Sunny } from '@element-plus/icons-vue'
import { useUserStore } from '~/store/useUserStore'
import { useCheckinStats, useCheckin } from '~/composables/user'
import { toastError } from '~/utils/popup'
import type { CheckinStats } from '~~/shared/types/user'

definePageMeta({
  title: '首页',
  isHome: true,
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

// 打卡统计
const { isLoading: statsLoading, execute: fetchCheckinStats } = useCheckinStats()
const { isLoading: checkinLoading, execute: doCheckin } = useCheckin()
const checkinStats = ref<CheckinStats | null>(null)

// 判断今日是否已签到
const isCheckedIn = computed(() => {
  if (!checkinStats.value?.lastCheckinTime) return false
  const lastDate = new Date(checkinStats.value.lastCheckinTime)
  const now = new Date()
  return (
    lastDate.getFullYear() === now.getFullYear() &&
    lastDate.getMonth() === now.getMonth() &&
    lastDate.getDate() === now.getDate()
  )
})

// 总loading状态
const isLoading = computed(() => statsLoading.value)

// 格式化学习时长（秒 → 可读格式）
const formatStudyTime = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h${mins}min` : `${hours}h`
}

async function initStats() {
  const res = await fetchCheckinStats()
  if (res?.code === 200) {
    checkinStats.value = res.data
  }
}

async function handleCheckin() {
  if (isCheckedIn.value) return
  const res = await doCheckin()
  if (res?.code === 200) {
    checkinStats.value = res.data
    toastSuccess(res.message, 2000)
  } else {
    toastError(res?.message || '签到失败，请稍后重试')
  }
}

onMounted(() => {
  initStats()
})
</script>

<template>
  <div class="home-page">
    <!-- Loading状态 -->
    <div v-if="isLoading" class="loading-container">
      <DotPulse />
    </div>

    <template v-else>
      <!-- 顶部问候 -->
      <div class="greeting-section">
        <div class="greeting-text">
          <ClientOnly> {{ greeting }}，{{ user?.nickname || '学习者' }} </ClientOnly>
        </div>
        <div v-if="checkinStats?.currentStreakDays" class="streak-badge">
          <el-icon><Sunny /></el-icon>
          <span>连续 {{ checkinStats.currentStreakDays }} 天</span>
        </div>
      </div>

      <!-- 签到卡片 -->
      <div class="checkin-card" :class="{ 'checked-in': isCheckedIn }" @click="handleCheckin">
        <div class="checkin-icon">
          <el-icon :size="32"><Sunny /></el-icon>
        </div>
        <div class="checkin-text">
          <template v-if="checkinLoading">签到中...</template>
          <template v-else-if="isCheckedIn">今日已签到</template>
          <template v-else>今日签到</template>
          <!-- <template v-else>开始签到</template> -->
        </div>
      </div>

      <!-- 开始学习按钮 -->
      <div class="learn-section">
        <NuxtLink v-if="isCheckedIn" to="/learn" class="learn-btn"> 开始学习 </NuxtLink>
        <div v-else="isCheckedIn" class="learn-btn" style="cursor: pointer" @click="handleCheckin">
          点击签到
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="stats-section">
        <div class="stat-card">
          <div class="stat-label">累计学习</div>
          <div class="stat-value">{{ formatStudyTime(checkinStats?.totalStudySeconds ?? 0) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已学习</div>
          <div class="stat-value">{{ checkinStats?.totalCheckinDays ?? 0 }}天</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.home-page {
  padding: 16px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
}

/* 问候区域 */
.greeting-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
  position: absolute;
  width: 90%;
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

/* 签到卡片 */
.checkin-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  margin: 180px auto 0;
  max-width: 200px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow);
  cursor: pointer;
  transition:
    transform 0.2s,
    opacity 0.2s;
}

.checkin-card:active {
  transform: scale(0.96);
}

.checkin-card.checked-in {
  opacity: 0.7;
  cursor: default;
}

.checkin-card.checked-in:active {
  transform: none;
}

.checkin-icon {
  color: #fff;
  margin-bottom: 12px;
}

.checkin-text {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

/* 开始学习按钮 */
.learn-section {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

.learn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 40px;
  background: var(--primary);
  border-radius: var(--r-m);
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  text-decoration: none;
  transition: opacity 0.2s;
}

.learn-btn:active {
  opacity: 0.85;
}

/* 统计卡片区域 */
.stats-section {
  display: flex;
  gap: 12px;
  margin-top: auto;
  padding-bottom: 50px;
}

.stat-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 16px;
  background: var(--card);
  border-radius: var(--r-l);
  box-shadow: var(--shadow);
}

.stat-label {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
}

/* Loading */
.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}
</style>
