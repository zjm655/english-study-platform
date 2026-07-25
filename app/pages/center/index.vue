<template>
  <div class="profile-page">
    <!-- 登录态由 authVerify.server 插件在 SSR 期写入 store，本页可直接 SSR 直出，无需 ClientOnly -->
    <!-- 未登录状态 -->
    <div v-if="!isLogin" class="not-login">
      <el-icon :size="64" class="not-login__icon"><UserFilled /></el-icon>
      <p class="not-login__text">登录后查看更多功能</p>
      <NuxtLink to="/login">
        <el-button type="primary">去登录</el-button>
      </NuxtLink>
    </div>

    <!-- 已登录状态 -->
    <template v-else>
      <!-- 用户信息卡片 -->
      <div class="user-card">
        <div class="user-info">
          <div class="avatar">
            <el-avatar :size="64" :src="user?.avatarUrl ?? undefined">
              <el-icon :size="32"><UserFilled /></el-icon>
            </el-avatar>
          </div>
          <div class="user-details">
            <div class="nickname">{{ user?.nickname || '未设置昵称' }}</div>
            <div class="level-badge">
              <el-tag :type="levelType" size="small">{{ levelText }}</el-tag>
            </div>
          </div>
        </div>
        <div class="user-stats">
          <div class="stat-item">
            <div class="stat-value">{{ checkinStats?.currentStreakDays ?? 0 }}</div>
            <div class="stat-label">连续学习</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-value">
              {{ formatStudyTime(checkinStats?.totalStudySeconds ?? 0) }}
            </div>
            <div class="stat-label">累计学习</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-value">{{ userStats?.completedSegments ?? 0 }}</div>
            <div class="stat-label">已完成片段</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-value">
              {{ userStats?.avgDubbingScore != null ? userStats.avgDubbingScore + '分' : '--' }}
            </div>
            <div class="stat-label">配音平均分</div>
          </div>
        </div>
      </div>

      <!-- 设置菜单 -->
      <div class="settings-section">
        <div class="section-title">设置</div>
        <div class="menu-list">
          <div v-if="isAdmin" class="menu-item" @click="goAdmin">
            <el-icon><Platform /></el-icon>
            <span>管理员后台</span>
            <el-icon class="arrow"><ArrowRight /></el-icon>
          </div>
          <div class="menu-item" @click="handleEditProfile">
            <el-icon><Edit /></el-icon>
            <span>编辑资料</span>
            <el-icon class="arrow"><ArrowRight /></el-icon>
          </div>
          <div class="menu-item" @click="handleLearningGoal">
            <el-icon><TrophyBase /></el-icon>
            <span>学习目标</span>
            <el-icon class="arrow"><ArrowRight /></el-icon>
          </div>
          <div class="menu-item" @click="handleNotification">
            <el-icon><Bell /></el-icon>
            <span>提醒设置</span>
            <el-icon class="arrow"><ArrowRight /></el-icon>
          </div>
          <div class="menu-item">
            <el-icon><Moon /></el-icon>
            <span>深色模式</span>
            <el-switch v-model="isDarkMode" class="switch" />
          </div>
          <div class="menu-item" @click="handleAbout">
            <el-icon><InfoFilled /></el-icon>
            <span>关于我们</span>
            <el-icon class="arrow"><ArrowRight /></el-icon>
          </div>
        </div>
      </div>

      <!-- 退出登录按钮 -->
      <div class="logout-section">
        <el-button type="danger" plain @click="handleLogout">退出登录</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  UserFilled,
  Edit,
  TrophyBase,
  Bell,
  Moon,
  ArrowRight,
  InfoFilled,
  Platform,
} from '@element-plus/icons-vue'
import { useUserStore } from '~/store/useUserStore'
import { useCheckinStats, useLogout } from '~/composables/user'
import { useUserStats } from '~/composables/user/useUserStats'
import { toastConfirm } from '~/utils/popup'
import { isAdminOrAbove } from '#shared/utils/role'
import type { CheckinStats } from '~~/shared/types/user'
import type { UserStats } from '#shared/types/user'

definePageMeta({
  title: '个人中心',
})

useSeoMeta({
  title: '个人中心',
  description: '管理个人资料、收藏与学习统计。',
  // 隐私页无 SEO 价值，不让搜索引擎收录
  robots: 'noindex, nofollow',
})

const userStore = useUserStore()
const user = computed(() => userStore.user)
const isLogin = computed(() => userStore.isLogin)
// 仅管理员/超管可见后台入口（UX 层隐藏，真正防线在后端 /api/admin/* 门禁）
const isAdmin = computed(() => isAdminOrAbove(user.value?.role))

// 打卡统计
const { isLoading: _statsLoading, execute: fetchCheckinStats } = useCheckinStats()
const { execute: doLogout } = useLogout()
const { isLoading: _userStatsLoading, execute: fetchUserStats } = useUserStats()
const checkinStats = ref<CheckinStats | null>(null)
const userStats = ref<UserStats | null>(null)

const { theme, setTheme } = useTheme()
const isDarkMode = computed({
  get: () => theme.value === 'dark',
  set: (v: boolean) => setTheme(v ? 'dark' : 'light'),
})

// 等级映射
const levelText = computed(() => {
  const levels = ['未测试', '初级', '中级', '高级']
  return levels[user.value?.level ?? 0] || '未测试'
})

const levelType = computed(() => {
  const types = ['info', 'success', 'warning', 'danger'] as const
  return types[user.value?.level ?? 0] || 'info'
})

// 格式化学习时长（秒 → 可读格式）
const formatStudyTime = (seconds: number) => {
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
}

// 获取打卡统计
async function initStats() {
  const res = await fetchCheckinStats()
  if (res?.code === 200) {
    checkinStats.value = res.data
  }
  const statsRes = await fetchUserStats(undefined)
  if (statsRes?.code === 200) {
    userStats.value = statsRes.data
  }
}

// 事件处理（后台入口落到 /admin 首页，由首页按权限展示模块入口）
const goAdmin = () => navigateTo('/admin')

const handleEditProfile = () => {
  logger.log('编辑资料')
}

const handleLearningGoal = () => {
  logger.log('学习目标')
}

const handleNotification = () => {
  logger.log('提醒设置')
}

// 深色模式切换由 el-switch v-model 驱动，无需额外 handler

const handleAbout = () => {
  logger.log('关于我们')
}

const handleLogout = async () => {
  try {
    await toastConfirm('退出登录后将无法自动登录，确定退出吗？', '退出登录', {
      confirmButtonText: '确定退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }

  const res = await doLogout()
  if (res?.code === 200) {
    // clearUser 内含 isVerify=false：登出后下次导航重新校验，避免 SSR 化后残留登录态
    userStore.clearUser()
    navigateTo('/login')
  }
}

onMounted(() => {
  if (isLogin.value) {
    initStats()
  }
})

watch(isLogin, (newVal) => {
  if (newVal) {
    initStats()
  }
})
</script>

<style scoped>
.profile-page {
  padding: 16px;
  min-height: 100%;
}

/* 未登录状态 */
.not-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.not-login__icon {
  color: var(--text-3);
  margin-bottom: 16px;
}

.not-login__text {
  font-size: 15px;
  color: var(--text-2);
  margin-bottom: 24px;
}

/* 用户信息卡片 */
.user-card {
  background: var(--card);
  border-radius: var(--r-xl);
  padding: 24px 20px;
  box-shadow: var(--shadow);
  margin-bottom: 20px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.avatar {
  flex-shrink: 0;
}

.user-details {
  flex: 1;
  min-width: 0;
}

.nickname {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 6px;
}

.level-badge {
  display: inline-block;
}

.user-stats {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding-top: 16px;
  border-top: 1px solid var(--border-ll);
}

.stat-item {
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-3);
}

.stat-divider {
  width: 1px;
  height: 32px;
  background: var(--border-ll);
}

/* 设置区域 */
.settings-section {
  background: var(--card);
  border-radius: var(--r-xl);
  padding: 16px 0;
  box-shadow: var(--shadow);
  margin-bottom: 20px;
}

.section-title {
  font-size: 14px;
  color: var(--text-3);
  padding: 0 20px 12px;
}

.menu-list {
  display: flex;
  flex-direction: column;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 14px 20px;
  cursor: pointer;
  transition: background 0.2s;
}

.menu-item:hover {
  background: var(--bg);
}

.menu-item:active {
  background: var(--border-ll);
}

.menu-item .el-icon {
  font-size: 20px;
  color: var(--text-2);
  margin-right: 12px;
}

.menu-item span {
  flex: 1;
  font-size: 15px;
  color: var(--text-1);
}

.menu-item .arrow {
  font-size: 14px;
  color: var(--text-4);
  margin-right: 0;
  margin-left: auto;
}

.menu-item .switch {
  margin-left: auto;
}

/* 退出登录 */
.logout-section {
  padding: 20px 0;
}

.logout-section .el-button {
  width: 100%;
}
</style>
