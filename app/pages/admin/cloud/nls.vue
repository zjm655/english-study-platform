<!-- app/pages/admin/cloud/nls.vue：NLS 智能语音交互用量（本地埋点估算） -->
<template>
  <div class="cloud-page" v-loading="isLoading">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">NLS 智能语音交互</h2>
        <p class="page-desc">录音文件识别（FlashRecognizer）· 本地埋点估算</p>
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
        <span class="metric-sub">近 {{ days }} 天语音识别请求</span>
      </div>
      <div class="metric-cell metric-cell--orange">
        <span class="metric-label">估算费用</span>
        <span class="metric-value">￥{{ data?.estimate.totalEstimatedCost.toFixed(2) ?? '--' }}</span>
        <span class="metric-sub">单价 ￥{{ data?.estimate.unitPrice ?? 0 }}/次</span>
      </div>
      <div class="metric-cell metric-cell--green">
        <span class="metric-label">估算识别时长</span>
        <span class="metric-value">{{ estimatedHours }}<i class="metric-unit">小时</i></span>
        <span class="metric-sub">按每次约 2 分钟估算</span>
      </div>
    </div>

    <!-- 调用趋势图 -->
    <section class="panel trend-panel">
      <header class="panel-head">
        <h3 class="panel-title">调用趋势</h3>
        <span class="panel-note">基于 cloud_service_call_log 按天聚合</span>
      </header>
      <div ref="trendChartRef" class="trend-chart"></div>
    </section>

    <!-- 估算面板 -->
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
        ⚠️ 基于本地 API 调用埋点估算，仅供参考。录音上传（/api/recording POST）亦触发 ASR 校对，已纳入统计。
        官方计费按音频时长（2.50 元/小时），此处按次估算为保守近似。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { use, graphic, init } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { NlsStatResult } from '#shared/types/adminCloud'
import { useAdminCloudNls, useCloudTrend } from '~/composables/admin'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

definePageMeta({ layout: 'admin' })

const days = ref(7)
const { isLoading, execute } = useAdminCloudNls()
const { isLoading: trendLoading, execute: executeTrend } = useCloudTrend()
const data = ref<NlsStatResult | null>(null)

// 趋势图
const trendChartRef = ref<HTMLElement | null>(null)
let trendChart: EChartsType | null = null

/** 估算识别时长（小时）：每次调用约 2 分钟 */
const estimatedHours = computed(() => {
  const calls = data.value?.estimate.totalCalls ?? 0
  return ((calls * 2) / 60).toFixed(1)
})

async function fetchData() {
  const res = await execute({ days: days.value })
  if (res.code === 200 && res.data) {
    data.value = res.data
  }
  // 并行加载趋势数据
  const trendRes = await executeTrend({ service: 'nls', days: days.value })
  if (trendRes.code === 200 && trendRes.data) {
    renderTrendChart(trendRes.data.dates, trendRes.data.callCounts, trendRes.data.totalDurations)
  }
}

function renderTrendChart(dates: string[], callCounts: number[], totalDurations: number[]) {
  if (!trendChartRef.value) return
  if (!trendChart) {
    trendChart = init(trendChartRef.value)
  }
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['调用次数', '总耗时(ms)'], bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 50, right: 60, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 11 } },
    yAxis: [
      { type: 'value', name: '调用次数', axisLabel: { fontSize: 11 }, splitLine: { show: false } },
      { type: 'value', name: '耗时(ms)', axisLabel: { fontSize: 11 }, splitLine: { show: false } },
    ],
    series: [
      {
        name: '调用次数',
        type: 'line',
        data: callCounts,
        smooth: true,
        itemStyle: { color: '#409EFF' },
        areaStyle: { color: new graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(64,158,255,0.25)' },
          { offset: 1, color: 'rgba(64,158,255,0.02)' },
        ])},
      },
      {
        name: '总耗时(ms)',
        type: 'line',
        yAxisIndex: 1,
        data: totalDurations,
        smooth: true,
        itemStyle: { color: '#E6A23C' },
        areaStyle: { color: new graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(230,162,60,0.25)' },
          { offset: 1, color: 'rgba(230,162,60,0.02)' },
        ])},
      },
    ],
  })
}

onMounted(() => fetchData())
onUnmounted(() => { trendChart?.dispose() })
</script>

<style scoped>
.cloud-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-title { font-size: 22px; font-weight: 700; color: var(--text-1); }
.page-desc { margin-top: 6px; font-size: 13px; color: var(--text-3); }
.header-actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

.metric-band {
  display: grid; grid-template-columns: repeat(3, 1fr);
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

.panel { background: var(--card); border-radius: var(--r-lg); box-shadow: var(--shadow); padding: 18px 20px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.panel-note { font-size: 12px; color: var(--text-4); }
.path-code { font-family: 'Cascadia Code', 'Consolas', monospace; font-size: 12px; background: var(--bg); padding: 2px 6px; border-radius: 4px; }
.estimate-note { margin-top: 12px; font-size: 12px; color: var(--text-3); line-height: 1.6; }

.trend-panel { margin-bottom: 0; }
.trend-chart { width: 100%; height: 280px; }

@media (max-width: 1100px) {
  .metric-band { grid-template-columns: 1fr; }
}
</style>
