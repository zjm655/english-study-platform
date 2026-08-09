<script setup lang="ts">
import { Sunny } from '@element-plus/icons-vue'
import { useUserStore } from '~/store/useUserStore'
import { useCheckin } from '~/composables/user'
import { userCheckinStatsPath } from '~/api/paths'
import type { CheckinStats } from '#shared/types/user'

definePageMeta({
  title: '首页',
  isHome: true,
})

useSeoMeta({
  title: '首页',
  description:
    '每日签到开启英语学习：盲听磨耳、原文精学、AI 配音评分、影子跟读，四阶段闭环提升听说能力。',
})
useJsonLd(educationalOrgSchema())

const userStore = useUserStore()
const user = computed(() => userStore.user)
const isLogin = computed(() => userStore.isLogin)

// 问候语
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

// 打卡统计：useAsyncRes（登录用户 + 游客均请求，后端对游客也返回真实数据）
const { data: statsRes, pending: statsLoading } = useAsyncRes<CheckinStats>(
  'checkin-stats',
  userCheckinStatsPath,
  undefined,
  { immediate: true },
)
const checkinStats = computed(() => statsRes.value?.data ?? null)
const { isLoading: checkinLoading, execute: doCheckin } = useCheckin()

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

// 总 loading状态
const isLoading = computed(() => statsLoading.value && !statsRes.value)

// 格式化学习时长（秒 → 可读格式）
const formatStudyTime = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h${mins}min` : `${hours}h`
}

async function handleCheckin() {
  if (isCheckedIn.value) return
  const res = await doCheckin()
  if (res?.code === 200) {
    // 签到响应即权威新值，直接写回 useAsyncData 的 data（避免双数据源/多一次刷新请求）
    statsRes.value = res
    toastSuccess(res.message, 2000)
  } else {
    toastError(res?.message || '签到失败，请稍后重试')
  }
}
</script>

<template>
  <div class="home-page">
    <!-- Loading状态 -->
    <div v-if="isLoading" class="loading-container">
      <DotPulse />
    </div>

    <template v-else>
      <!-- 顶部问候：游客显示欢迎体验 -->
      <div class="greeting-section">
        <div class="greeting-text">
          <template v-if="!isLogin"> 欢迎体验 </template>
          <template v-else>
            <!-- greeting 依赖浏览器本地时间保留 ClientOnly（fallback 占位防跳动）；nickname 已由 SSR verify 直出 -->
            <ClientOnly>{{ greeting }}<template #fallback>你好</template></ClientOnly
            >，{{ user?.nickname || '学习者' }}
          </template>
        </div>
        <div v-if="checkinStats?.currentStreakDays" class="streak-badge">
          <el-icon><Sunny /></el-icon>
          <span>连续 {{ checkinStats.currentStreakDays }} 天</span>
        </div>
      </div>

      <!-- 签到卡片：登录用户和游客均可签到 -->
      <div class="checkin-card" :class="{ 'checked-in': isCheckedIn }" @click="handleCheckin()">
        <div class="checkin-icon">
          <el-icon :size="32"><Sunny /></el-icon>
        </div>
        <div class="checkin-text">
          <template v-if="checkinLoading">签到中...</template>
          <template v-else-if="isCheckedIn">今日已签到</template>
          <template v-else>今日签到</template>
        </div>
      </div>

      <!-- 开始学习按钮：游客也可直接进入学习页 -->
      <div class="learn-section">
        <NuxtLink v-if="isLogin && isCheckedIn" to="/learn" class="learn-btn">开始学习</NuxtLink>
        <NuxtLink v-else-if="!isLogin" to="/learn" class="learn-btn">开始学习</NuxtLink>
        <div v-else class="learn-btn" style="cursor: pointer" @click="handleCheckin">点击签到</div>
      </div>

      <!-- 统计卡片：登录用户和游客均显示真实数据 -->
      <div class="stats-section">
        <div class="stat-card">
          <div class="stat-label">累计学习</div>
          <div class="stat-value">
            {{ formatStudyTime(checkinStats?.totalStudySeconds ?? 0) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">已学习</div>
          <div class="stat-value">{{ (checkinStats?.totalCheckinDays ?? 0) + '天' }}</div>
        </div>
      </div>

      <!-- 底部登录引导（降级为小字链接） -->
      <div v-if="!isLogin" class="guest-login-hint">
        登录后可同步数据到正式账户、收藏单词
        <NuxtLink to="/login" class="guest-login-link">去登录</NuxtLink>
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

/* 底部登录引导（降级为小字链接） */
.guest-login-hint {
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
  margin-top: 8px;
  padding-bottom: 24px;
}

.guest-login-link {
  color: var(--primary);
  text-decoration: none;
  margin-left: 4px;
}

/* Loading */
.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}
</style>
