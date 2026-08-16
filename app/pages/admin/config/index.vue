<script setup lang="ts">
import {
  Refresh,
  Medal,
  Odometer,
  UploadFilled,
  Key,
  Cloudy,
  MagicStick,
  DataLine,
} from '@element-plus/icons-vue'
import { useConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'

// 分域面板组件：位于 components/admin/config/ 嵌套目录，Nuxt 自动注册会带路径前缀，
// 必须显式 import 才能以裸组件名使用（与 phases 组件同先例）
import EvalServicePanel from '~/components/admin/config/EvalServicePanel.vue'
import TrafficLimitPanel from '~/components/admin/config/TrafficLimitPanel.vue'
import UploadResourcePanel from '~/components/admin/config/UploadResourcePanel.vue'
import GuestPolicyPanel from '~/components/admin/config/GuestPolicyPanel.vue'
import CloudServicePanel from '~/components/admin/config/CloudServicePanel.vue'
import AiContentPanel from '~/components/admin/config/AiContentPanel.vue'
import LogMonitorPanel from '~/components/admin/config/LogMonitorPanel.vue'

definePageMeta({ layout: 'admin' })

// 三层架构：页面只调 composable（内含 loading / 防重 / 401-403 跳转），不裸调 request
const { execute: fetchConfigsExec } = useConfigs()

// ─── 功能域导航（2026-08-16 分组重构：9 卡平铺 → 7 域卡片导航 + 组内独立保存） ───
const DOMAINS = [
  { key: 'eval', label: '评测服务', icon: Medal },
  { key: 'traffic', label: '流量与限流', icon: Odometer },
  { key: 'upload', label: '上传与资源', icon: UploadFilled },
  { key: 'guest', label: '游客策略', icon: Key },
  { key: 'cloud', label: '云服务', icon: Cloudy },
  { key: 'ai', label: 'AI 内容生成', icon: MagicStick },
  { key: 'log', label: '日志与监控', icon: DataLine },
] as const

const activeDomain = ref<string>('eval')

// 全部配置一次拉取（分域面板经 props 下发；各面板独立保存本域键）
const loading = ref(false)
const configMap = ref<AdminConfigMap>({})

async function fetchConfigs() {
  loading.value = true
  try {
    const res = await fetchConfigsExec(null)
    if (res.code === 200 && res.data) {
      configMap.value = res.data
    }
  } finally {
    loading.value = false
  }
}

function onRefresh() {
  fetchConfigs()
}

onMounted(fetchConfigs)
</script>

<template>
  <div v-loading="loading" class="config-page">
    <div class="config-header">
      <div>
        <h2 class="config-page-title">系统配置</h2>
        <p class="config-desc">
          按功能域分组管理全局策略，每组独立保存即时生效；低频参数收在「高级设置」内。
        </p>
      </div>
      <el-tooltip content="刷新配置" placement="top">
        <el-button :icon="Refresh" circle @click="onRefresh" />
      </el-tooltip>
    </div>

    <div class="config-layout">
      <!-- 二级功能域导航（卡片式，参考 admin 首页 module-card：图标 + 标题 + 激活高亮；
           单页本地切换，未来可平滑升级子路由） -->
      <nav class="config-nav">
        <button
          v-for="d in DOMAINS"
          :key="d.key"
          type="button"
          class="config-nav__item"
          :class="{ 'is-active': activeDomain === d.key }"
          @click="activeDomain = d.key"
        >
          <el-icon class="config-nav__icon"><component :is="d.icon" /></el-icon>
          <span>{{ d.label }}</span>
        </button>
      </nav>

      <!-- 当前域内容区（v-show 保留各面板状态） -->
      <div class="config-content">
        <EvalServicePanel
          v-show="activeDomain === 'eval'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
        <TrafficLimitPanel
          v-show="activeDomain === 'traffic'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
        <UploadResourcePanel
          v-show="activeDomain === 'upload'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
        <GuestPolicyPanel
          v-show="activeDomain === 'guest'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
        <CloudServicePanel
          v-show="activeDomain === 'cloud'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
        <AiContentPanel
          v-show="activeDomain === 'ai'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
        <LogMonitorPanel
          v-show="activeDomain === 'log'"
          :config-map="configMap"
          @refresh="onRefresh"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.config-page {
  padding: 20px;
}
.config-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.config-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
}
.config-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-3);
}
.config-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.config-nav {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.config-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r-lg, 12px);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  text-align: left;
  transition:
    box-shadow 0.2s,
    border-color 0.2s,
    transform 0.15s;
}
.config-nav__item:hover {
  box-shadow: var(--shadow);
  border-color: var(--el-color-primary-light-5);
}
.config-nav__item:active {
  transform: scale(0.98);
}
/* 激活态：主题色渐变（参考首页签到卡渐变做法 + admin 主题色） */
.config-nav__item.is-active {
  background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
  color: #fff;
  border-color: transparent;
  box-shadow: var(--shadow);
}
.config-nav__icon {
  font-size: 18px;
}
/* 面板内容限宽：长表单行不再拉满整屏，行内控件比例更协调 */
.config-content {
  flex: 1;
  min-width: 0;
  max-width: 720px;
}
/* 面板卡片质感：阴影 + 大圆角（参考 admin 首页 module-card） */
.config-content :deep(.config-card) {
  border-radius: var(--r-lg, 12px);
  box-shadow: var(--shadow);
}

@media (max-width: 900px) {
  .config-layout {
    flex-direction: column;
  }
  .config-nav {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .config-nav__item {
    width: auto;
    flex: 1 1 auto;
  }
}
</style>
