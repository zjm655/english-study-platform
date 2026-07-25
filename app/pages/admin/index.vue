<template>
  <div class="admin-home-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">管理后台</h2>
        <p class="page-desc">
          欢迎，{{
            userStore.user?.nickname || userStore.user?.account
          }}。以下是你有权限访问的管理模块。
        </p>
      </div>
    </div>

    <!-- 有权限：模块入口卡片 -->
    <div v-if="modules.length > 0" class="module-grid">
      <el-card
        v-for="m in modules"
        :key="m.path"
        class="module-card"
        shadow="hover"
        @click="navigateTo(m.path)"
      >
        <div class="module-card__body">
          <el-icon class="module-card__icon" :size="28"><component :is="m.icon" /></el-icon>
          <div>
            <div class="module-card__title">{{ m.title }}</div>
            <div class="module-card__desc">{{ m.desc }}</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 零权限：明确空态提示，避免空白页困惑 -->
    <el-card v-else shadow="never" class="empty-card">
      <el-empty description="暂未分配任何管理权限">
        <template #image>
          <el-icon :size="64" class="empty-icon"><Lock /></el-icon>
        </template>
        <p class="empty-hint">
          你已是管理员身份，但尚未获得任何模块的操作权限，请联系超级管理员为你分配权限。
        </p>
      </el-empty>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import {
  User,
  Cloudy,
  MagicStick,
  Document,
  DataAnalysis,
  Notebook,
  Setting,
  Lock,
} from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { usePermission } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'
import { PERMISSIONS } from '#shared/utils/permission'
import type { PermissionKey } from '#shared/utils/permission'

definePageMeta({
  layout: 'admin',
  title: '管理后台',
})

useSeoMeta({ title: '管理后台' })

const userStore = useUserStore()
const { can } = usePermission()

/** 模块目录：与侧边栏的权限门禁一一对应（此处仅体验层，真正防线在后端） */
const MODULE_CATALOG: {
  path: string
  title: string
  desc: string
  icon: Component
  permission: PermissionKey
}[] = [
  {
    path: '/admin/material',
    title: '材料管理',
    desc: '材料列表 / 单元列表 / 上传与记录',
    icon: Document,
    permission: PERMISSIONS.MANAGE_MATERIALS,
  },
  {
    path: '/admin/users',
    title: '用户管理',
    desc: '用户查询 / 封禁解封 / 资料维护',
    icon: User,
    permission: PERMISSIONS.MANAGE_USERS,
  },
  {
    path: '/admin/stats',
    title: '运营统计',
    desc: 'API 调用概览 / 趋势 / 错误分布',
    icon: DataAnalysis,
    permission: PERMISSIONS.VIEW_STATS,
  },
  {
    path: '/admin/cloud/oss',
    title: '阿里云服务',
    desc: 'OSS / NLS / 智能科教 / BSS 费用',
    icon: Cloudy,
    permission: PERMISSIONS.VIEW_STATS,
  },
  {
    path: '/admin/cloud/deepseek',
    title: 'DeepSeek',
    desc: '余额查询 / Token 用量趋势',
    icon: MagicStick,
    permission: PERMISSIONS.VIEW_STATS,
  },
  {
    path: '/admin/logs/api-call',
    title: '日志管理',
    desc: 'API / 云服务 / 操作日志查询导出',
    icon: Notebook,
    permission: PERMISSIONS.VIEW_LOGS,
  },
  {
    path: '/admin/logs/review-access',
    title: '审核留痕',
    desc: 'REVIEW 敏感操作留痕查询导出',
    icon: Lock,
    permission: PERMISSIONS.VIEW_AUDIT,
  },
  {
    path: '/admin/config',
    title: '系统配置',
    desc: '评测额度 / 限流等全局配置',
    icon: Setting,
    permission: PERMISSIONS.CONFIG,
  },
]

const modules = computed(() => MODULE_CATALOG.filter((m) => can(m.permission)))
</script>

<style scoped>
.admin-home-page {
  width: 100%;
}

.page-header {
  margin-bottom: 20px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 6px;
}

.page-desc {
  font-size: 14px;
  color: var(--text-3);
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.module-card {
  cursor: pointer;
}

.module-card__body {
  display: flex;
  align-items: center;
  gap: 14px;
}

.module-card__icon {
  color: var(--el-color-primary);
  flex-shrink: 0;
}

.module-card__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 4px;
}

.module-card__desc {
  font-size: 13px;
  color: var(--text-3);
}

.empty-card {
  padding: 24px 0;
}

.empty-icon {
  color: var(--text-3);
}

.empty-hint {
  font-size: 14px;
  color: var(--text-3);
  max-width: 420px;
  margin: 0 auto;
}
</style>
