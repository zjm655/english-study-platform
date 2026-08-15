<!-- app/pages/admin/cloud/edu.vue：智能科教平台用量（本地埋点估算） -->
<template>
  <div v-loading="isLoading" class="cloud-page">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">智能科教平台</h2>
        <p class="page-desc">
          口语评测（配音/跟读打分）· 精确埋点统计（P1-D 起，切换点 2026-08-15）
        </p>
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
        <span class="metric-value"
          >{{ data?.estimate.totalCalls.toLocaleString() ?? '--'
          }}<i class="metric-unit">次</i></span
        >
        <span class="metric-sub">近 {{ days }} 天评测请求</span>
      </div>
      <div class="metric-cell metric-cell--orange">
        <span class="metric-label">估算费用</span>
        <span class="metric-value"
          >￥{{ data?.estimate.totalEstimatedCost.toFixed(2) ?? '--' }}</span
        >
        <span class="metric-sub">单价 ￥{{ data?.estimate.unitPrice ?? 0 }}/次</span>
      </div>
      <div class="metric-cell metric-cell--green">
        <span class="metric-label">日均调用</span>
        <span class="metric-value">{{ dailyAvg }}<i class="metric-unit">次/天</i></span>
        <span class="metric-sub">近 {{ days }} 天平均</span>
      </div>
    </div>

    <!-- 调用趋势 -->
    <section class="panel trend-panel">
      <header class="panel-head">
        <h3 class="panel-title">调用趋势</h3>
        <span class="panel-note">按天聚合评测鉴权成功调用次数</span>
      </header>
      <div ref="trendChartRef" class="trend-chart"></div>
    </section>

    <!-- 估算面板 -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">评测鉴权调用明细</h3>
        <span class="panel-note">基于 cloud_service_call_log 精确统计（service=edu）</span>
      </header>
      <el-table
        v-if="data?.estimate.byPath.length"
        :data="data.estimate.byPath"
        stripe
        size="small"
      >
        <el-table-column prop="path" label="路径" min-width="200">
          <template #default="{ row }">
            <code class="path-code">{{ row.path }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column prop="count" label="成功调用次数" width="120" align="right">
          <template #default="{ row }">{{ row.count.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="unitPrice" label="单价(元)" width="100" align="right">
          <template #default="{ row }">￥{{ row.unitPrice }}</template>
        </el-table-column>
        <el-table-column prop="estimatedCost" label="费用" width="110" align="right">
          <template #default="{ row }">￥{{ row.estimatedCost.toFixed(3) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="范围内无调用记录" :image-size="64" />
      <p class="estimate-note">
        ℹ️ 精确口径（2026-08-15 P1-D 起）：统计 evaluation/auth
        换证成功（service=edu，operation=warrant， success=1），官方计费 0.004
        元/次（失败不计费）。recording/*/analyze 仅将前端评测结果入库、后端不调用
        评测平台，不计费。失败调用可在「日志管理 → 云服务调用日志」按 service=edu 筛选查看。
        切换前历史数据不可比（此前为 api_call_log 代理估算）。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { use, graphic, init } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { EduStatResult } from '#shared/types/adminCloud'
import { useAdminCloudEdu, useCloudTrend, useChartResize } from '~/composables/admin'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

definePageMeta({ layout: 'admin' })

const days = ref(7)
const { isLoading, execute } = useAdminCloudEdu()
const { execute: executeTrend } = useCloudTrend()
const data = ref<EduStatResult | null>(null)

// 趋势图
const trendChartRef = ref<HTMLElement | null>(null)
let trendChart: EChartsType | null = null

// 容器尺寸变化时自适应，卸载时统一 dispose
useChartResize([{ getChart: () => trendChart, containerRef: trendChartRef }])

/** 日均调用次数 */
const dailyAvg = computed(() => {
  const calls = data.value?.estimate.totalCalls ?? 0
  return Math.round(calls / days.value).toLocaleString()
})

async function fetchData() {
  const res = await execute({ days: days.value })
  if (res.code === 200 && res.data) {
    data.value = res.data
  }
  await fetchTrend()
}

async function fetchTrend() {
  const res = await executeTrend({ service: 'edu', days: days.value })
  if (res.code === 200 && res.data) {
    renderTrendChart(res.data.dates, res.data.callCounts)
  }
}

function renderTrendChart(dates: string[], callCounts: number[]) {
  if (!trendChartRef.value) return
  if (!trendChart) {
    trendChart = init(trendChartRef.value)
  }
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 45, right: 20, top: 20, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { fontSize: 11, formatter: (v: string) => (v.length >= 10 ? v.slice(5) : v) },
    },
    yAxis: {
      type: 'value',
      name: '调用次数',
      axisLabel: { fontSize: 11 },
      splitLine: { show: false },
    },
    series: [
      {
        name: '评测调用',
        type: 'line',
        data: callCounts,
        smooth: true,
        itemStyle: { color: '#409EFF' },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64,158,255,0.25)' },
            { offset: 1, color: 'rgba(64,158,255,0.02)' },
          ]),
        },
      },
    ],
  })
}

onMounted(() => fetchData())
</script>

<style scoped>
.cloud-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
}
.page-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-3);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.metric-band {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.metric-cell {
  position: relative;
  padding: 22px 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.metric-cell + .metric-cell {
  border-left: 1px solid var(--border-ll);
}
.metric-cell::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.3s ease;
}
.metric-cell:hover::before {
  transform: scaleX(1);
}
.metric-cell--blue::before {
  background: var(--primary);
}
.metric-cell--green::before {
  background: var(--success);
}
.metric-cell--orange::before {
  background: var(--warning);
}
.metric-label {
  font-size: 12px;
  color: var(--text-3);
  letter-spacing: 1px;
}
.metric-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.metric-unit {
  font-style: normal;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3);
  margin-left: 3px;
}
.metric-sub {
  font-size: 12px;
  color: var(--text-4);
}

.panel {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 18px 20px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.panel-note {
  font-size: 12px;
  color: var(--text-4);
}
.path-code {
  font-family: 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  background: var(--bg);
  padding: 2px 6px;
  border-radius: 4px;
}
.estimate-note {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}

.trend-chart {
  width: 100%;
  height: 280px;
}

@media (max-width: 1100px) {
  .metric-band {
    grid-template-columns: 1fr;
  }
}
</style>
