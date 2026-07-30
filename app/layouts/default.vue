<!-- app/layouts/default.vue -->
<template>
  <div class="app-wrapper" :class="{ 'app-wrapper--full': isFullWidth }">
    <!-- ===== Header ===== -->
    <header v-if="!hideHeader" class="header">
      <div class="header__inner">
        <!-- 左侧：Logo（点击回首页） -->
        <NuxtLink to="/" class="header__brand">
          <div v-if="isHome" class="header__logo">S</div>
          <div v-else class="header__back" @click="goBack">
            <el-icon><Back /></el-icon>
          </div>
          <div class="header__text">
            <span class="header__name">Shadow</span>
            <span class="header__sub">英语伴学平台</span>
          </div>
        </NuxtLink>
        <!-- 中间：当前页面标题（从 definePageMeta({ title }) 读取） -->
        <h1 v-if="pageTitle" class="header__title">{{ pageTitle }}</h1>
        <!-- 右侧：首页显示消息中心铃铛（登录且有未读时叠加红点），其余页面保持返回首页 -->
        <div class="header__actions">
          <NuxtLink v-if="isHome" to="/notice" class="header__icon-btn" aria-label="消息中心">
            <el-icon :size="24"><Bell /></el-icon>
            <span v-if="unreadCount > 0" class="header__dot"></span>
          </NuxtLink>
          <NuxtLink v-else to="/" class="header__icon-btn">
            <el-icon :size="26"><HomeFilled /></el-icon>
          </NuxtLink>
        </div>
      </div>
    </header>

    <!-- ===== Main ===== -->
    <main
      class="main-content"
      :class="{ 'main-content--no-header': hideHeader, 'main-content--no-footer': hideTabBar }"
    >
      <slot />
    </main>

    <!-- ===== Footer TabBar ===== -->
    <footer v-if="!hideTabBar" class="footer">
      <nav class="tabbar">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.path"
          :to="tab.path"
          class="tabbar__item"
          :class="{ 'tabbar__item--on': isActive(tab.path) }"
        >
          <component :is="tab.icon" class="tabbar__icon" />
          <span class="tabbar__label">{{ tab.label }}</span>
        </NuxtLink>
      </nav>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { HomeFilled, List, RefreshRight, UserFilled, Back, Bell } from '@element-plus/icons-vue'
import { useNoticeUnread } from '~/composables/notice'
import { useUserStore } from '~/store/useUserStore'

const { init: initTheme } = useTheme()

const route = useRoute()
const pageTitle = computed(() => (route.meta?.title as string) || '')
const hideHeader = computed(() => !!route.meta?.hideHeader)
const hideTabBar = computed(() => !!route.meta?.hideTabBar)
const isFullWidth = computed(() => !!route.meta?.fullWidth)
const isHome = computed(() => !!route.meta?.isHome)

const tabs = [
  { path: '/', label: '首页', icon: HomeFilled },
  { path: '/learn', label: '学习', icon: List },
  { path: '/review', label: '复习', icon: RefreshRight },
  { path: '/center', label: '我的', icon: UserFilled },
]

function isActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
const router = useRouter()
function goBack() {
  router.back()
}

// 未读公告红点：严格客户端拉取（onMounted 且登录态才请求，游客恒不显示）
const userStore = useUserStore()
const { unreadCount, refresh: refreshUnread } = useNoticeUnread()

onMounted(() => {
  initTheme()
  refreshUnread()
})

// 会话内登录后（布局不重挂载）补拉一次未读数
watch(
  () => userStore.isLogin,
  (v) => {
    if (v) {
      refreshUnread()
    } else {
      // 登出时清零红点（refresh 对游客直接跳过请求，不会清零，需手动归零）
      unreadCount.value = 0
    }
  },
)
</script>

<style>
/* ===== Layout ===== */
/* 移动端 430px 限宽从 body 下沉至此：仅约束 default 布局（学习/复习/首页/我的），admin 布局不受影响；
   需要全宽的页面（如登录页 PC 双栏）用 definePageMeta({ fullWidth: true }) 豁免 */
.app-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 430px;
  margin: 0 auto;
}

.app-wrapper--full {
  max-width: none;
}

/* ===== Header ===== */
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  z-index: 10;
  display: flex;
  justify-content: center;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.08);
}

.header__inner {
  width: 100%;
  max-width: 430px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
}

/* 左侧品牌 */
.header__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: #fff;
  flex-shrink: 0;
}

.header__logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}

.header__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.header__name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.header__sub {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
}

/* 中间页面标题 */
.header__title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* 右侧操作区 */
.header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header__icon-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.9);
  font-size: 18px;
  transition: background 0.2s;
}

.header__icon-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}

.header__dot {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid var(--primary);
}

/* ===== Main ===== */
.main-content {
  padding-top: 56px;
  padding-bottom: 60px;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.main-content--no-header {
  padding-top: 0;
}

.main-content--no-footer {
  padding-bottom: 0;
}

/* ===== Footer TabBar ===== */
.footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--card);
  border-top: 1px solid var(--border-ll);
  z-index: 100;
  display: flex;
  justify-content: center;
}

.tabbar {
  width: 100%;
  max-width: 430px;
  display: flex;
}

.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  text-decoration: none;
  color: var(--text-3);
  font-size: 10px;
  transition: color 0.2s;
  padding: 4px 0;
  -webkit-tap-highlight-color: transparent;
}

.tabbar__item--on {
  color: var(--primary);
}

.tabbar__icon {
  font-size: 20px;
  line-height: 1;
}

.tabbar__label {
  font-size: 10px;
  line-height: 1.2;
}
</style>
