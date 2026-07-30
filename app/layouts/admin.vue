<!-- app/layouts/admin.vue：管理后台 PC 优先布局（左侧导航 + 右侧内容） -->
<template>
  <div class="admin-layout">
    <aside class="admin-sidebar" :class="{ 'admin-sidebar--collapsed': isCollapsed }">
      <div class="admin-brand">
        <span class="admin-brand__logo">S</span>
        <span class="admin-brand__text">Shadow 管理后台</span>
      </div>

      <!-- collapse 态由 Element Plus 自动隐藏文字、只保留 title 中的 el-icon（子菜单转为悬浮弹出） -->
      <el-menu
        ref="menuRef"
        :default-active="activeMenu"
        router
        class="admin-menu"
        :collapse="isCollapsed"
        :collapse-transition="false"
      >
        <el-menu-item index="/admin">
          <el-icon><HomeFilled /></el-icon>
          <span>首页</span>
        </el-menu-item>
        <el-sub-menu v-if="can(PERMISSIONS.MANAGE_MATERIALS)" index="/admin/material">
          <template #title>
            <el-icon><Document /></el-icon>
            <span>材料管理</span>
          </template>
          <el-menu-item index="/admin/material">材料列表</el-menu-item>
          <el-menu-item index="/admin/unit">单元列表</el-menu-item>
          <el-menu-item index="/admin/material/upload">材料上传</el-menu-item>
          <el-menu-item index="/admin/material/records">上传记录</el-menu-item>
        </el-sub-menu>
        <el-menu-item v-if="can(PERMISSIONS.MANAGE_USERS)" index="/admin/users">
          <el-icon><User /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.VIEW_STATS)" index="/admin/stats">
          <el-icon><DataAnalysis /></el-icon>
          <span>运营统计</span>
        </el-menu-item>
        <el-sub-menu v-if="can(PERMISSIONS.VIEW_STATS)" index="/admin/cloud">
          <template #title>
            <el-icon><Cloudy /></el-icon>
            <span>阿里云服务</span>
          </template>
          <el-menu-item index="/admin/cloud/oss">OSS 对象存储</el-menu-item>
          <el-menu-item index="/admin/cloud/nls">NLS 语音交互</el-menu-item>
          <el-menu-item index="/admin/cloud/edu">智能科教平台</el-menu-item>
          <el-menu-item index="/admin/cloud/bss">BSS 费用中心</el-menu-item>
        </el-sub-menu>
        <el-menu-item v-if="can(PERMISSIONS.VIEW_STATS)" index="/admin/cloud/deepseek">
          <el-icon><MagicStick /></el-icon>
          <span>DeepSeek</span>
        </el-menu-item>
        <el-sub-menu
          v-if="can(PERMISSIONS.VIEW_LOGS) || can(PERMISSIONS.VIEW_AUDIT)"
          index="/admin/logs"
        >
          <template #title>
            <el-icon><Notebook /></el-icon>
            <span>日志管理</span>
          </template>
          <el-menu-item v-if="can(PERMISSIONS.VIEW_LOGS)" index="/admin/logs/api-call"
            >API 调用日志</el-menu-item
          >
          <el-menu-item v-if="can(PERMISSIONS.VIEW_LOGS)" index="/admin/logs/cloud-service"
            >云服务日志</el-menu-item
          >
          <el-menu-item v-if="can(PERMISSIONS.VIEW_LOGS)" index="/admin/logs/operation"
            >操作日志</el-menu-item
          >
          <el-menu-item v-if="can(PERMISSIONS.VIEW_AUDIT)" index="/admin/logs/review-access"
            >审核留痕</el-menu-item
          >
        </el-sub-menu>
        <el-menu-item v-if="can(PERMISSIONS.CONFIG)" index="/admin/monitor">
          <el-icon><Odometer /></el-icon>
          <span>运行监控</span>
        </el-menu-item>
        <el-menu-item v-if="can(PERMISSIONS.CONFIG)" index="/admin/config">
          <el-icon><Setting /></el-icon>
          <span>系统配置</span>
        </el-menu-item>
      </el-menu>

      <div class="admin-sidebar__footer">
        <!-- 深色模式切换：展开态整行 switch，收起态退化为单图标按钮 -->
        <div v-if="!isCollapsed" class="admin-theme">
          <el-icon><Moon /></el-icon>
          <span>深色模式</span>
          <el-switch v-model="isDarkMode" class="admin-theme__switch" size="small" />
        </div>
        <button
          v-else
          type="button"
          class="admin-back admin-footer-btn"
          :title="isDarkMode ? '切换为浅色模式' : '切换为深色模式'"
          @click="isDarkMode = !isDarkMode"
        >
          <el-icon><Sunny v-if="isDarkMode" /><Moon v-else /></el-icon>
        </button>

        <NuxtLink to="/" class="admin-back" :title="isCollapsed ? '返回前台' : undefined">
          <el-icon><Back /></el-icon>
          <span v-show="!isCollapsed">返回前台</span>
        </NuxtLink>

        <!-- 侧边栏收起/展开切换 -->
        <button
          type="button"
          class="admin-back admin-footer-btn"
          :title="isCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="isCollapsed = !isCollapsed"
        >
          <el-icon><Expand v-if="isCollapsed" /><Fold v-else /></el-icon>
          <span v-show="!isCollapsed">收起侧边栏</span>
        </button>
      </div>
    </aside>

    <main class="admin-main" :class="{ 'admin-main--collapsed': isCollapsed }">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import {
  User,
  Cloudy,
  MagicStick,
  Back,
  Document,
  DataAnalysis,
  Notebook,
  Odometer,
  Setting,
  HomeFilled,
  Moon,
  Sunny,
  Fold,
  Expand,
} from '@element-plus/icons-vue'
import type { MenuInstance } from 'element-plus'
import { usePermission } from '~/composables/user'
import { PERMISSIONS } from '#shared/utils/permission'

const { can } = usePermission()

const { theme, setTheme, init: initTheme } = useTheme()

// 深色模式开关：读取当前主题，写入时在 dark/light 间切换
const isDarkMode = computed({
  get: () => theme.value === 'dark',
  set: (v: boolean) => setTheme(v ? 'dark' : 'light'),
})

// 侧边栏收缩状态（localStorage 持久化，仅客户端读写，SSR 期不触碰）
const COLLAPSE_KEY = 'admin-sidebar-collapsed'
const isCollapsed = ref(false)

watch(isCollapsed, (v) => {
  localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0')
})

const route = useRoute()

const menuRef = ref<MenuInstance | null>(null)

// 与模板中三个 el-sub-menu 的 index 保持同步维护
const SUB_MENU_INDEXES = ['/admin/material', '/admin/cloud', '/admin/logs']

// 收起态子菜单 popper 依赖 mouseleave 关闭，触屏设备没有 mouseleave 事件，
// 点击子项跳转后 popper 会残留并再次浮现；这里在路由变化时主动关闭所有子菜单
watch(
  () => route.path,
  () => {
    if (isCollapsed.value) SUB_MENU_INDEXES.forEach((i) => menuRef.value?.close(i))
  },
)

// 侧边栏高亮：default-active 必须精确匹配 el-menu-item 的 index（叶子节点）。
// el-sub-menu 的展开由 Element Plus 根据 active item 的父链自动处理，无需手动映射。
const activeMenu = computed(() => {
  const path = route.path
  // 材料编辑页（/admin/material/:id）归到「材料列表」
  if (
    path.startsWith('/admin/material/') &&
    path !== '/admin/material/upload' &&
    path !== '/admin/material/records'
  ) {
    return '/admin/material'
  }
  // 用户详情页（/admin/users/:id）归到「用户列表」
  if (path.startsWith('/admin/users/') && path !== '/admin/users') {
    return '/admin/users'
  }
  // 其余路径直接返回（云服务子项 /admin/cloud/oss 等精确匹配 el-menu-item index）
  return path
})

onMounted(() => {
  initTheme()
  // 恢复侧边栏收缩状态（onMounted 只在客户端执行，SSR 安全）
  isCollapsed.value = localStorage.getItem(COLLAPSE_KEY) === '1'
})
</script>

<style scoped>
.admin-layout {
  display: flex;
  min-height: 100vh;
}

.admin-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--card);
  border-right: 1px solid var(--border-ll);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  transition: width 0.3s ease;
}

/* 收起态：宽度对齐 el-menu collapse 默认的 64px */
.admin-sidebar--collapsed {
  width: 64px;
}

.admin-sidebar--collapsed .admin-brand {
  justify-content: center;
  padding: 20px 0;
}

.admin-sidebar--collapsed .admin-brand__text {
  display: none;
}

.admin-sidebar--collapsed .admin-sidebar__footer {
  padding: 16px 0;
  align-items: center;
}

.admin-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px;
  border-bottom: 1px solid var(--border-ll);
}

.admin-brand__logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.admin-brand__text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.admin-menu {
  flex: 1;
  border-right: none;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

.admin-menu::-webkit-scrollbar {
  width: 6px;
}

.admin-menu::-webkit-scrollbar-thumb {
  background: var(--border-ll);
  border-radius: 3px;
}

.admin-menu__todo {
  margin-left: 8px;
}

.admin-sidebar__footer {
  padding: 16px;
  border-top: 1px solid var(--border-ll);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 深色模式整行（展开态） */
.admin-theme {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  font-size: 14px;
}

.admin-theme__switch {
  margin-left: auto;
}

/* footer 内按钮：复用 .admin-back 外观，仅重置原生 button 样式 */
.admin-footer-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
}

.admin-back {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
  text-decoration: none;
  font-size: 14px;
  transition: color 0.2s;
}

.admin-back:hover {
  color: var(--primary);
}

.admin-main {
  flex: 1;
  margin-left: 220px;
  padding: 24px;
  background: var(--bg);
  min-width: 0;
  transition: margin-left 0.3s ease;
}

.admin-main--collapsed {
  margin-left: 64px;
}
</style>
