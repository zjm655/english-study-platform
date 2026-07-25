<!-- app/layouts/admin.vue：管理后台 PC 优先布局（左侧导航 + 右侧内容） -->
<template>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="admin-brand">
        <span class="admin-brand__logo">S</span>
        <span class="admin-brand__text">Shadow 管理后台</span>
      </div>

      <el-menu :default-active="activeMenu" router class="admin-menu">
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
        <el-menu-item v-if="can(PERMISSIONS.CONFIG)" index="/admin/config">
          <el-icon><Setting /></el-icon>
          <span>系统配置</span>
        </el-menu-item>
      </el-menu>

      <div class="admin-sidebar__footer">
        <NuxtLink to="/" class="admin-back">
          <el-icon><Back /></el-icon>
          <span>返回前台</span>
        </NuxtLink>
      </div>
    </aside>

    <main class="admin-main">
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
  Setting,
  HomeFilled,
} from '@element-plus/icons-vue'
import { usePermission } from '~/composables/user'
import { PERMISSIONS } from '#shared/utils/permission'

const { can } = usePermission()

const { init: initTheme } = useTheme()

const route = useRoute()

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
}

.admin-menu__todo {
  margin-left: 8px;
}

.admin-sidebar__footer {
  padding: 16px;
  border-top: 1px solid var(--border-ll);
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
}
</style>
