<!-- app/pages/admin/stats/index.vue：运营统计看板（API 调用埋点聚合展示） -->
<template>
  <div class="stats-page" v-loading="isLoading">
    <!-- 页头：标题 + 实时采集指示 + 时间范围切换 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">运营统计</h2>
        <p class="page-desc">
          <span class="live-dot" aria-hidden="true"></span>
          API 调用全链路埋点 · 错误率口径 HTTP ≥ 400
        </p>
      </div>
      <div class="header-actions">
        <el-radio-group v-model="days" @change="fetchStats">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
        </el-radio-group>
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" circle @click="fetchStats" />
        </el-tooltip>
      </div>
    </div>

    <!-- 指标带：单卡五格，数字滚动动画 -->
    <div class="metric-band">
      <div
        v-for="m in metricCells"
        :key="m.label"
        class="metric-cell"
        :class="`metric-cell--${m.tone}`"
      >
        <span class="metric-label">{{ m.label }}</span>
        <span class="metric-value">
          {{ m.display }}<i v-if="m.unit" class="metric-unit">{{ m.unit }}</i>
        </span>
        <span class="metric-sub">{{ m.sub }}</span>
      </div>
    </div>

    <!-- 主图表区：趋势（大）+ 热门接口（小） -->
    <div class="chart-grid">
      <section class="panel panel--trend">
        <header class="panel-head">
          <h3 class="panel-title">调用趋势</h3>
          <div class="panel-legend">
            <span class="legend-chip legend-chip--calls">调用量</span>
            <span class="legend-chip legend-chip--errors">错误数</span>
          </div>
        </header>
        <div ref="trendChartRef" class="chart-body chart-body--trend"></div>
        <p v-if="!hasData && !isLoading" class="chart-empty">暂无调用数据，等待埋点上报后将自动生成趋势</p>
      </section>

      <section class="panel panel--top">
        <header class="panel-head">
          <h3 class="panel-title">热门接口 Top 10</h3>
        </header>
        <div ref="topChartRef" class="chart-body chart-body--top"></div>
        <p v-if="!hasData && !isLoading" class="chart-empty">暂无数据</p>
      </section>
    </div>

    <!-- 次级区：错误路径排行 + （安全视角 / 云服务） -->
    <div class="sub-grid">
      <section class="panel panel--errors">
        <header class="panel-head">
          <h3 class="panel-title">错误路径分布</h3>
          <span class="panel-note">HTTP ≥ 400</span>
        </header>
        <div class="error-list" v-if="statsData?.errorPaths.length">
          <div
            v-for="(item, idx) in statsData.errorPaths"
            :key="item.path + item.method"
            class="error-row"
          >
            <span class="error-rank" :class="{ 'error-rank--hot': idx < 3 }">{{ idx + 1 }}</span>
            <span class="error-method">{{ item.method }}</span>
            <span class="error-path" :title="item.path">{{ item.path }}</span>
            <div class="error-bar-track">
              <div
                class="error-bar-fill"
                :style="{ width: barWidth(item.count, maxErrorCount) }"
              ></div>
            </div>
            <span class="error-count">{{ item.count }}</span>
          </div>
        </div>
        <el-empty v-else description="范围内无 HTTP 级错误" :image-size="64" />
      </section>

      <div class="right-stack">
        <section class="panel panel--security">
          <header class="panel-head">
            <h3 class="panel-title">安全视角</h3>
          </header>
          <div class="security-body">
            <div class="security-hero">
              <span class="security-number">{{ animUnauth.display }}</span>
              <span class="security-caption">未认证调用（user_id 为空）</span>
            </div>
            <ul class="security-notes">
              <li>未认证调用包含：登录/注册等公开接口、未携带有效 Cookie 的请求</li>
              <li>若该指标异常攀升，可能存在爬虫探测或接口滥用</li>
              <li>业务错误码（401/403 等）以 HTTP 200 返回，不计入错误率</li>
            </ul>
          </div>
        </section>

        <section class="panel panel--cloud">
          <header class="panel-head">
            <h3 class="panel-title">云服务</h3>
            <span class="panel-note">阿里云 BSS</span>
          </header>
          <div v-if="cloudBalance?.success" class="cloud-body">
            <div class="cloud-hero">
              <span class="cloud-number">￥{{ cloudBalance.availableAmount ?? '--' }}</span>
              <span class="cloud-caption">可用额度（{{ cloudBalance.currency ?? 'CNY' }}）</span>
            </div>
            <div class="cloud-rows">
              <div class="cloud-row">
                <span>可用现金</span><b>￥{{ cloudBalance.availableCashAmount ?? '--' }}</b>
              </div>
              <div class="cloud-row">
                <span>信用额度</span><b>￥{{ cloudBalance.creditAmount ?? '--' }}</b>
              </div>
            </div>
          </div>
          <div v-else class="cloud-unavailable">
            <el-icon :size="22"><WarningFilled /></el-icon>
            <p>余额暂不可用</p>
            <span>{{ cloudBalance?.error || '加载失败或未配置' }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import { use, graphic, init } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { AdminStatsResult, DailyTrendItem, CloudBalanceResult } from '#shared/types/adminStats'
import { useAdminStats, useAdminStatsCloud } from '~/composables/admin'

use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

definePageMeta({ layout: 'admin' })

// ============ 数据获取 ============

const days = ref(7)
const { isLoading, execute } = useAdminStats()
const { execute: executeCloud } = useAdminStatsCloud()
const statsData = ref<AdminStatsResult | null>(null)
const cloudBalance = ref<CloudBalanceResult | null>(null)

const hasData = computed(() => (statsData.value?.summary.totalCalls ?? 0) > 0)

async function fetchStats() {
  const res = await execute({ days: days.value })
  if (res.code === 200 && res.data) {
    statsData.value = res.data
    syncAnimatedMetrics()
    updateCharts()
  }
}

/** 云账户余额独立拉取（失败不影响主看板，静默降级） */
async function fetchCloudBalance() {
  const res = await executeCloud()
  if (res.code === 200 && res.data) {
    cloudBalance.value = res.data
  }
}

// ============ 数字滚动动画 ============

interface AnimNum { value: number }
const animToday = ref<AnimNum>({ value: 0 })
const animTotal = ref<AnimNum>({ value: 0 })
const animRate = ref<AnimNum>({ value: 0 })      // 实际值 ×100 存储，展示时 /100
const animDuration = ref<AnimNum>({ value: 0 })
const animUsers = ref<AnimNum>({ value: 0 })
const animUnauth = ref<AnimNum>({ value: 0 })

/** requestAnimationFrame 数字滚动（easeOutCubic） */
function animateTo(target: { value: number }, to: number, duration = 700) {
  const from = target.value
  if (from === to) return
  const start = performance.now()
  const step = (now: number) => {
    const progress = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    target.value = from + (to - from) * eased
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function syncAnimatedMetrics() {
  const s = statsData.value?.summary
  if (!s) return
  animateTo(animToday.value, s.todayCalls)
  animateTo(animTotal.value, s.totalCalls)
  animateTo(animRate.value, Math.round(s.errorRate * 100))
  animateTo(animDuration.value, s.avgDuration)
  animateTo(animUsers.value, s.activeUsers)
  animateTo(animUnauth.value, s.unauthCalls)
}

/** 指标带配置（响应式派生） */
const metricCells = computed(() => {
  const rate = animRate.value.value / 100
  return [
    {
      label: '今日调用',
      display: Math.round(animToday.value.value).toLocaleString(),
      unit: '次',
      sub: '当日 0 时至今',
      tone: 'blue',
    },
    {
      label: '总调用量',
      display: Math.round(animTotal.value.value).toLocaleString(),
      unit: '次',
      sub: `近 ${days.value} 天`,
      tone: 'blue',
    },
    {
      label: '错误率',
      display: rate.toFixed(2),
      unit: '%',
      sub: rate > 5 ? '高于 5%，需关注' : '运行平稳',
      tone: rate > 5 ? 'red' : 'green',
    },
    {
      label: '平均耗时',
      display: Math.round(animDuration.value.value).toLocaleString(),
      unit: 'ms',
      sub: '全接口均值',
      tone: 'orange',
    },
    {
      label: '活跃用户',
      display: Math.round(animUsers.value.value).toLocaleString(),
      unit: '人',
      sub: '去重调用者',
      tone: 'green',
    },
  ]
})

// ============ 图表 ============

const trendChartRef = ref<HTMLElement>()
const topChartRef = ref<HTMLElement>()
let trendChart: EChartsType | null = null
let topChart: EChartsType | null = null
let resizeObserver: ResizeObserver | null = null

const maxErrorCount = computed(() =>
  Math.max(1, ...(statsData.value?.errorPaths.map(i => i.count) ?? [1]))
)

function barWidth(count: number, max: number) {
  return `${Math.max(4, (count / max) * 100)}%`
}

/** 补齐无数据日期为 0，保证趋势轴连续 */
function fillTrendGap(trend: DailyTrendItem[], range: number): DailyTrendItem[] {
  const map = new Map(trend.map(i => [i.date, i]))
  const result: DailyTrendItem[] = []
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    result.push(map.get(key) ?? { date: key, count: 0, errorCount: 0, avgDuration: 0 })
  }
  return result
}

function updateCharts() {
  if (!statsData.value) return
  updateTrendChart()
  updateTopChart()
}

function updateTrendChart() {
  if (!trendChart || !statsData.value) return
  const trend = fillTrendGap(statsData.value.dailyTrend, days.value)
  const dates = trend.map(i => i.date.slice(5))  // MM-DD 展示更紧凑
  trendChart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#ebeef5',
      textStyle: { color: '#303133', fontSize: 12 },
      formatter(params: any) {
        const full = trend[params[0].dataIndex]
        const lines = params.map((p: any) =>
          `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>${p.seriesName}：<b>${p.value.toLocaleString()}</b>`
        )
        return `<div style="font-weight:600;margin-bottom:4px;">${full.date}</div>${lines.join('<br/>')}<br/><span style="color:#909399;">平均耗时 ${full.avgDuration} ms</span>`
      },
    },
    grid: { left: 48, right: 20, top: 24, bottom: 32 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e4e7ed' } },
      axisTick: { show: false },
      axisLabel: { color: '#909399', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#ebeef5', type: 'dashed' } },
      axisLabel: { color: '#909399', fontSize: 11 },
    },
    series: [
      {
        name: '调用量',
        type: 'line',
        data: trend.map(i => i.count),
        smooth: 0.35,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: trend.length <= 31,
        lineStyle: { width: 2.5, color: '#409eff' },
        itemStyle: { color: '#409eff', borderColor: '#fff', borderWidth: 1.5 },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64,158,255,0.28)' },
            { offset: 1, color: 'rgba(64,158,255,0.02)' },
          ]),
        },
      },
      {
        name: '错误数',
        type: 'line',
        data: trend.map(i => i.errorCount),
        smooth: 0.35,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: trend.length <= 31,
        lineStyle: { width: 2, color: '#f56c6c' },
        itemStyle: { color: '#f56c6c', borderColor: '#fff', borderWidth: 1.5 },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(245,108,108,0.18)' },
            { offset: 1, color: 'rgba(245,108,108,0.01)' },
          ]),
        },
      },
    ],
    animationDuration: 600,
    animationEasing: 'cubicOut',
  })
}

function updateTopChart() {
  if (!topChart || !statsData.value) return
  // 条形图从下往上排列（echarts y 轴 category 逆序），取前 10 反转
  const items = [...statsData.value.topPaths].slice(0, 10).reverse()
  topChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#fff',
      borderColor: '#ebeef5',
      textStyle: { color: '#303133', fontSize: 12 },
      formatter(params: any) {
        const item = items[params[0].dataIndex]
        return `<div style="font-weight:600;margin-bottom:4px;">${item.method} ${item.path}</div>调用 <b>${item.count.toLocaleString()}</b> 次 · 平均 ${item.avgDuration} ms`
      },
    },
    grid: { left: 158, right: 56, top: 8, bottom: 8 },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category',
      data: items.map(i => i.path),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#606266',
        fontSize: 11,
        width: 150,
        overflow: 'truncate',
        ellipsis: '…',
      },
    },
    series: [
      {
        type: 'bar',
        data: items.map(i => i.count),
        barWidth: 14,
        itemStyle: {
          borderRadius: [0, 7, 7, 0],
          color: new graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#79bbff' },
            { offset: 1, color: '#409eff' },
          ]),
        },
        label: {
          show: true,
          position: 'right',
          color: '#909399',
          fontSize: 11,
          formatter: (p: any) => p.value.toLocaleString(),
        },
      },
    ],
    animationDuration: 600,
    animationEasing: 'cubicOut',
  })
}

function initCharts() {
  if (trendChartRef.value) {
    trendChart = init(trendChartRef.value)
  }
  if (topChartRef.value) {
    topChart = init(topChartRef.value)
  }
  // 容器尺寸变化时自适应（侧边栏固定，主内容区随窗口变化）
  resizeObserver = new ResizeObserver(() => {
    trendChart?.resize()
    topChart?.resize()
  })
  if (trendChartRef.value) resizeObserver.observe(trendChartRef.value)
  if (topChartRef.value) resizeObserver.observe(topChartRef.value)
}

onMounted(() => {
  initCharts()
  fetchStats()
  fetchCloudBalance()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  trendChart?.dispose()
  topChart?.dispose()
  trendChart = null
  topChart = null
})
</script>

<style scoped>
.stats-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 页头 ===== */
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
  letter-spacing: 0.5px;
}

.page-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 实时采集呼吸点 */
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  position: relative;
  flex-shrink: 0;
}
.live-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid var(--success);
  opacity: 0;
  animation: live-ping 2s ease-out infinite;
}
@keyframes live-ping {
  0% { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(1.6); opacity: 0; }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* ===== 指标带 ===== */
.metric-band {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
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
  transition: background 0.25s;
}
.metric-cell + .metric-cell {
  border-left: 1px solid var(--border-ll);
}
.metric-cell:hover {
  background: #fafcff;
}
/* 顶部色调条：悬停时展开 */
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
.metric-cell--blue::before { background: var(--primary); }
.metric-cell--green::before { background: var(--success); }
.metric-cell--red::before { background: var(--danger); }
.metric-cell--orange::before { background: var(--warning); }

.metric-label {
  font-size: 12px;
  color: var(--text-3);
  letter-spacing: 1px;
}

.metric-value {
  font-size: 30px;
  font-weight: 700;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.metric-cell--red .metric-value { color: var(--danger); }
.metric-cell--green .metric-value { color: var(--success); }

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
.metric-cell--red .metric-sub { color: var(--danger); opacity: 0.8; }

/* ===== 图表面板 ===== */
.chart-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
}

.sub-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
}

.panel {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 18px 20px;
  position: relative;
  transition: box-shadow 0.25s;
}
.panel:hover {
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.09);
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

.panel-legend {
  display: flex;
  gap: 12px;
}
.legend-chip {
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 5px;
}
.legend-chip::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.legend-chip--calls::before { background: var(--primary); }
.legend-chip--errors::before { background: var(--danger); }

.chart-body {
  width: 100%;
}
.chart-body--trend { height: 300px; }
.chart-body--top { height: 300px; }

.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-4);
  pointer-events: none;
}

/* ===== 错误路径排行 ===== */
.error-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.error-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--r);
  transition: background 0.2s;
}
.error-row:hover {
  background: #fdf6f6;
}

.error-rank {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-3);
  background: var(--bg);
  flex-shrink: 0;
}
.error-rank--hot {
  background: var(--danger);
  color: #fff;
}

.error-method {
  font-size: 11px;
  font-weight: 600;
  color: var(--danger);
  background: var(--danger-light);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.error-path {
  font-size: 12px;
  color: var(--text-2);
  font-family: 'Cascadia Code', 'Consolas', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 180px;
  flex-shrink: 0;
}

.error-bar-track {
  flex: 1;
  height: 6px;
  background: var(--bg);
  border-radius: 3px;
  overflow: hidden;
}
.error-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #fab6b6, #f56c6c);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.error-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  width: 48px;
  text-align: right;
  flex-shrink: 0;
}

/* ===== 安全视角 ===== */
.security-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.security-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0 12px;
  gap: 4px;
}

.security-number {
  font-size: 42px;
  font-weight: 700;
  color: var(--warning);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.security-caption {
  font-size: 12px;
  color: var(--text-3);
}

.security-notes {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--warning-light);
  border-radius: var(--r);
}
.security-notes li {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.6;
  padding-left: 14px;
  position: relative;
}
.security-notes li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--warning);
}

/* ===== 右列堆叠（安全视角 + 云服务） ===== */
.right-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* ===== 云服务（阿里云 BSS） ===== */
.cloud-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cloud-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 2px;
  gap: 4px;
}

.cloud-number {
  font-size: 32px;
  font-weight: 700;
  color: var(--primary-dark);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.cloud-caption {
  font-size: 12px;
  color: var(--text-3);
}

.cloud-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background: var(--primary-light);
  border-radius: var(--r);
}

.cloud-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
}
.cloud-row b {
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.cloud-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 16px;
  color: var(--text-4);
  text-align: center;
}
.cloud-unavailable p {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-3);
}
.cloud-unavailable span {
  font-size: 12px;
  word-break: break-all;
  max-width: 100%;
}

/* ===== 响应式（PC 宽屏优先，窄屏兜底） ===== */
@media (max-width: 1100px) {
  .metric-band { grid-template-columns: repeat(3, 1fr); }
  .metric-cell:nth-child(4) { border-left: none; }
  .chart-grid, .sub-grid { grid-template-columns: 1fr; }
}
</style>
