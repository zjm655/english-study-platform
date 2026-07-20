<!-- app/layouts/admin.vue：管理后台 PC 优先布局（左侧导航 + 右侧内容） -->
<template>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="admin-brand">
        <span class="admin-brand__logo">S</span>
        <span class="admin-brand__text">Shadow 管理后台</span>
      </div>

      <el-menu :default-active="route.path" router class="admin-menu">
        <el-menu-item index="/admin/material/upload">
          <el-icon><Upload /></el-icon>
          <span>材料上传</span>
        </el-menu-item>
        <el-menu-item index="/admin/users" disabled>
          <el-icon><User /></el-icon>
          <span>用户管理</span>
          <el-tag size="small" type="info" class="admin-menu__todo">TODO</el-tag>
        </el-menu-item>
        <el-menu-item index="/admin/cloud" disabled>
          <el-icon><Cloudy /></el-icon>
          <span>阿里云服务</span>
          <el-tag size="small" type="info" class="admin-menu__todo">TODO</el-tag>
        </el-menu-item>
        <el-menu-item index="/admin/ai" disabled>
          <el-icon><MagicStick /></el-icon>
          <span>DeepSeek</span>
          <el-tag size="small" type="info" class="admin-menu__todo">TODO</el-tag>
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
import { Upload, User, Cloudy, MagicStick, Back } from '@element-plus/icons-vue'

const route = useRoute()
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
