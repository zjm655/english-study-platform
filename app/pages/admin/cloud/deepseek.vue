<!-- app/pages/admin/cloud/deepseek.vue：DeepSeek AI 服务余额查询 -->
<template>
  <div class="cloud-page" v-loading="isLoading">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">DeepSeek AI 服务</h2>
        <p class="page-desc">账户余额查询 · Bearer Token 认证（复用 API Key）</p>
      </div>
      <div class="header-actions">
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" circle @click="fetchData" />
        </el-tooltip>
      </div>
    </div>

    <!-- 余额卡片 -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">账户余额</h3>
        <span class="panel-note">
          <el-tag v-if="data?.balance.isAvailable" type="success" size="small">服务可用</el-tag>
          <el-tag v-else-if="data?.balance.success && !data.balance.isAvailable" type="danger" size="small">余额不足</el-tag>
        </span>
      </header>
      <div v-if="data?.balance.success && data.balance.balances?.length" class="balance-body">
        <div
          v-for="(item, idx) in data.balance.balances"
          :key="idx"
          class="balance-card"
        >
          <div class="balance-hero">
            <span class="balance-number">￥{{ item.totalBalance }}</span>
            <span class="balance-caption">总可用余额（{{ item.currency }}）</span>
          </div>
          <div class="balance-rows">
            <div class="balance-row">
              <span>赠送余额</span><b>￥{{ item.grantedBalance }}</b>
            </div>
            <div class="balance-row">
              <span>充值余额</span><b>￥{{ item.toppedUpBalance }}</b>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="unavailable">
        <el-icon :size="22"><WarningFilled /></el-icon>
        <p>余额暂不可用</p>
        <span>{{ data?.balance.error || '加载失败或未配置' }}</span>
      </div>
    </section>

    <!-- 说明面板 -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">计费说明</h3>
      </header>
      <ul class="info-notes">
        <li>DeepSeek API 按输入/输出 token 分别计价，赠送余额优先扣除</li>
        <li>本项目使用 deepseek-v4-flash 模型，每次材料上传约消耗 5000 token（≈0.007 元）</li>
        <li>余额数据有 5 分钟服务端缓存，刷新按钮可获取最新数据</li>
        <li>认证方式：Bearer Token（即 DeepSeek API Key），无需额外配置</li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import type { DeepSeekStatResult } from '#shared/types/adminCloud'
import { useAdminCloudDeepseek } from '~/composables/admin'

definePageMeta({ layout: 'admin' })

const { isLoading, execute } = useAdminCloudDeepseek()
const data = ref<DeepSeekStatResult | null>(null)

async function fetchData() {
  const res = await execute()
  if (res.code === 200 && res.data) {
    data.value = res.data
  }
}

onMounted(() => fetchData())
</script>

<style scoped>
.cloud-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-desc { margin-top: 6px; font-size: 13px; color: var(--text-3); }
.header-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

.panel { background: var(--card); border-radius: var(--r-lg); box-shadow: var(--shadow); padding: 18px 20px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.panel-note { font-size: 12px; color: var(--text-4); }

.balance-body { display: flex; flex-direction: column; gap: 16px; }
.balance-card { display: flex; flex-direction: column; gap: 14px; }
.balance-hero { display: flex; flex-direction: column; align-items: center; padding: 16px 0 8px; gap: 4px; }
.balance-number { font-size: 40px; font-weight: 700; color: var(--primary-dark); font-variant-numeric: tabular-nums; line-height: 1; }
.balance-caption { font-size: 12px; color: var(--text-3); }
.balance-rows { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: var(--primary-light); border-radius: var(--r); }
.balance-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-2); }
.balance-row b { font-variant-numeric: tabular-nums; color: var(--text-1); }

.unavailable { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px 16px; color: var(--text-4); text-align: center; }
.unavailable p { font-size: 13px; font-weight: 600; color: var(--text-3); }
.unavailable span { font-size: 12px; word-break: break-all; }

.info-notes { list-style: none; display: flex; flex-direction: column; gap: 8px; padding: 0; }
.info-notes li { font-size: 13px; color: var(--text-2); line-height: 1.6; padding-left: 14px; position: relative; }
.info-notes li::before { content: ''; position: absolute; left: 0; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: var(--primary); }
</style>
