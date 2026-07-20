<!-- app/pages/admin/cloud/oss.vue：OSS 对象存储用量（本地埋点估算 + 官方 GetBucketStat） -->
<template>
  <div class="cloud-page" v-loading="isLoading">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">OSS 对象存储</h2>
        <p class="page-desc">本地埋点估算 + 官方 GetBucketStat 存储统计</p>
      </div>
      <div class="header-actions">
        <el-radio-group v-model="days" @change="fetchData">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
        </el-radio-group>
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" circle @click="fetchData" />
        </el-tooltip>
      </div>
    </div>

    <!-- 指标带 -->
    <div class="metric-band">
      <div class="metric-cell metric-cell--blue">
        <span class="metric-label">总调用次数</span>
        <span class="metric-value">{{ data?.estimate.totalCalls.toLocaleString() ?? '--' }}<i class="metric-unit">次</i></span>
        <span class="metric-sub">近 {{ days }} 天上传请求</span>
      </div>
      <div class="metric-cell metric-cell--orange">
        <span class="metric-label">估算费用</span>
        <span class="metric-value">￥{{ data?.estimate.totalEstimatedCost.toFixed(3) ?? '--' }}</span>
        <span class="metric-sub">单价 ￥{{ data?.estimate.unitPrice ?? 0 }}/次</span>
      </div>
      <div class="metric-cell metric-cell--green">
        <span class="metric-label">存储容量</span>
        <span class="metric-value">{{ formatBytes(data?.bucketStat.storage) }}</span>
        <span class="metric-sub">官方 GetBucketStat</span>
      </div>
      <div class="metric-cell metric-cell--blue">
        <span class="metric-label">Object 数量</span>
        <span class="metric-value">{{ data?.bucketStat.objectCount?.toLocaleString() ?? '--' }}</span>
        <span class="metric-sub">含材料音频 + 用户录音</span>
      </div>
    </div>

    <div class="content-grid">
      <!-- 本地估算面板 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">本地埋点估算明细</h3>
          <span class="panel-note">基于 api_call_log 统计</span>
        </header>
        <el-table v-if="data?.estimate.byPath.length" :data="data.estimate.byPath" stripe size="small">
          <el-table-column prop="path" label="路径" min-width="200">
            <template #default="{ row }">
              <code class="path-code">{{ row.path }}</code>
            </template>
          </el-table-column>
          <el-table-column prop="method" label="方法" width="80" />
          <el-table-column prop="count" label="调用次数" width="100" align="right">
            <template #default="{ row }">{{ row.count.toLocaleString() }}</template>
          </el-table-column>
          <el-table-column prop="unitPrice" label="单价(元)" width="100" align="right">
            <template #default="{ row }">￥{{ row.unitPrice }}</template>
          </el-table-column>
          <el-table-column prop="estimatedCost" label="估算费用" width="110" align="right">
            <template #default="{ row }">￥{{ row.estimatedCost.toFixed(3) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="范围内无调用记录" :image-size="64" />
        <p class="estimate-note">
          ⚠️ 基于本地 API 调用埋点估算，仅供参考。OSS 下载流量（signUrl 直连）无法埋点，以官方存储统计为主。
        </p>
      </section>

      <!-- 官方存储统计面板 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">官方存储统计</h3>
          <span class="panel-note">GetBucketStat</span>
        </header>
        <div v-if="data?.bucketStat.success" class="bucket-stat-body">
          <div class="stat-row">
            <span>总存储量</span><b>{{ formatBytes(data.bucketStat.storage) }}</b>
          </div>
          <div class="stat-row">
            <span>标准存储</span><b>{{ formatBytes(data.bucketStat.standardStorage) }}</b>
          </div>
          <div class="stat-row">
            <span>Object 数量</span><b>{{ data.bucketStat.objectCount?.toLocaleString() ?? '--' }}</b>
          </div>
        </div>
        <div v-else class="unavailable">
          <el-icon :size="22"><WarningFilled /></el-icon>
          <p>存储统计暂不可用</p>
          <span>{{ data?.bucketStat.error || '加载失败或未配置' }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import type { OssStatResult } from '#shared/types/adminCloud'
import { useAdminCloudOss } from '~/composables/admin'

definePageMeta({ layout: 'admin' })

const days = ref(7)
const { isLoading, execute } = useAdminCloudOss()
const data = ref<OssStatResult | null>(null)

async function fetchData() {
  const res = await execute({ days: days.value })
  if (res.code === 200 && res.data) {
    data.value = res.data
  }
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '--'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

onMounted(() => fetchData())
</script>

<style scoped>
.cloud-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-desc { margin-top: 6px; font-size: 13px; color: var(--text-3); }
.header-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

.metric-band {
  display: grid; grid-template-columns: repeat(4, 1fr);
  background: var(--card); border-radius: var(--r-lg); box-shadow: var(--shadow); overflow: hidden;
}
.metric-cell { position: relative; padding: 22px 24px 18px; display: flex; flex-direction: column; gap: 6px; }
.metric-cell + .metric-cell { border-left: 1px solid var(--border-ll); }
.metric-cell::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; transform: scaleX(0); transform-origin: left; transition: transform 0.3s ease; }
.metric-cell:hover::before { transform: scaleX(1); }
.metric-cell--blue::before { background: var(--primary); }
.metric-cell--green::before { background: var(--success); }
.metric-cell--orange::before { background: var(--warning); }
.metric-label { font-size: 12px; color: var(--text-3); letter-spacing: 1px; }
.metric-value { font-size: 28px; font-weight: 700; color: var(--text-1); font-variant-numeric: tabular-nums; line-height: 1.1; }
.metric-unit { font-style: normal; font-size: 13px; font-weight: 500; color: var(--text-3); margin-left: 3px; }
.metric-sub { font-size: 12px; color: var(--text-4); }

.content-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; }
.panel { background: var(--card); border-radius: var(--r-lg); box-shadow: var(--shadow); padding: 18px 20px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.panel-note { font-size: 12px; color: var(--text-4); }
.path-code { font-family: 'Cascadia Code', 'Consolas', monospace; font-size: 12px; background: var(--bg); padding: 2px 6px; border-radius: 4px; }
.estimate-note { margin-top: 12px; font-size: 12px; color: var(--text-3); line-height: 1.6; }

.bucket-stat-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; background: var(--primary-light); border-radius: var(--r); }
.stat-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-2); }
.stat-row b { font-variant-numeric: tabular-nums; color: var(--text-1); }

.unavailable { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px 16px; color: var(--text-4); text-align: center; }
.unavailable p { font-size: 13px; font-weight: 600; color: var(--text-3); }
.unavailable span { font-size: 12px; word-break: break-all; }

@media (max-width: 1100px) {
  .metric-band { grid-template-columns: repeat(2, 1fr); }
  .content-grid { grid-template-columns: 1fr; }
}
</style>
