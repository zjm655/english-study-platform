<!-- app/pages/admin/stats/index.vue：运营统计看板（API 调用埋点聚合展示） -->
<template>
  <div v-loading="isLoading" class="stats-page">
    <!-- 页头：标题 + 实时采集指示 + 时间范围切换 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">运营统计</h2>
        <p class="page-desc">
          <span class="live-dot" aria-hidden="true"></span>
          API 调用全链路埋点 · 错误率口径 HTTP ≥ 400 或业务码 ≥ 400（业务拒绝计入，2026-08-15 起）
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
        <p v-if="!hasData && !isLoading" class="chart-empty">
          暂无调用数据，等待埋点上报后将自动生成趋势
        </p>
      </section>

      <section class="panel panel--top">
        <header class="panel-head">
          <h3 class="panel-title">热门接口 Top 10</h3>
        </header>
        <div ref="topChartRef" class="chart-body chart-body--top"></div>
        <p v-if="!hasData && !isLoading" class="chart-empty">暂无数据</p>
      </section>
    </div>

    <!-- 次级区：错误路径排行 + 安全视角 -->
    <div class="sub-grid">
      <section class="panel panel--errors">
        <header class="panel-head">
          <h3 class="panel-title">错误路径分布</h3>
          <span class="panel-note">HTTP ≥ 400 或业务码 ≥ 400</span>
        </header>
        <div v-if="statsData?.errorPaths.length" class="error-list">
          <div
            v-for="(item, idx) in statsData.errorPaths"
            :key="item.path + item.method"
            class="error-row"
          >
            <span class="error-rank" :class="{ 'error-rank--hot': idx < 3 }">{{ idx + 1 }}</span>
            <span class="error-method">{{ item.method }}</span>
            <span
              class="error-path error-path--link"
              :title="`${item.path}（点击查看 API 调用日志）`"
              @click="goApiCallLog(item.path)"
            >
              {{ item.path }}
            </span>
            <div class="error-bar-track">
              <div
                class="error-bar-fill"
                :style="{ width: barWidth(item.count, maxErrorCount) }"
              ></div>
            </div>
            <span class="error-count">{{ item.count }}</span>
          </div>
        </div>
        <el-empty v-else description="范围内无错误" :image-size="64" />
      </section>

      <div class="right-stack">
        <section class="panel panel--security">
          <header class="panel-head">
            <h3 class="panel-title">安全视角</h3>
          </header>
          <div class="security-body">
            <div class="security-hero">
              <span class="security-number">{{
                (statsData?.summary?.unauthCalls ?? 0).toLocaleString()
              }}</span>
              <span class="security-caption">未认证调用（user_id 为空）</span>
            </div>
            <ul class="security-notes">
              <li>未认证调用包含：登录/注册等公开接口、未携带有效 Cookie 的请求</li>
              <li>若该指标异常攀升，可能存在爬虫探测或接口滥用</li>
              <li>
                错误率口径：HTTP ≥ 400 或业务码 ≥ 400（业务拒绝以 HTTP 200 返回，2026-08-15 起计入）
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>

    <!-- 告警事件（近 1 小时各来源计数 + 最近 5 条；独立接口，随加载/手动刷新拉取，60s 缓存） -->
    <section class="panel panel--events">
      <header class="panel-head">
        <h3 class="panel-title">告警事件</h3>
        <span class="panel-note">
          近 1 小时各来源计数（60s 缓存）
          <el-link type="primary" class="events-link" href="/admin/logs/events">查看全部 →</el-link>
        </span>
      </header>
      <div class="events-body">
        <div class="events-counts">
          <div v-for="(label, key) in EVENT_SOURCE_LABELS" :key="key" class="event-count-item">
            <span class="event-count-label">{{ label }}</span>
            <span
              class="event-count-value"
              :class="{ 'num-warning': (alertEvents?.countsBySource[key] ?? 0) > 0 }"
            >
              {{ alertEvents?.countsBySource[key] ?? 0 }}
            </span>
          </div>
        </div>
        <el-empty
          v-if="!alertEvents || alertEvents.recent.length === 0"
          description="近 1 小时无事件"
          :image-size="48"
        />
        <ul v-else class="event-list">
          <li v-for="ev in alertEvents.recent" :key="ev.id" class="event-item">
            <el-tag :type="ev.level === 'error' ? 'danger' : 'warning'" size="small" effect="plain">
              {{ EVENT_SOURCE_LABELS[ev.source] ?? ev.source }}
            </el-tag>
            <span class="event-code">{{ ev.code || '-' }}</span>
            <span class="event-msg">{{ ev.message || '-' }}</span>
            <span class="event-time">{{ formatEventTime(ev.createdAt) }}</span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { use, graphic, init } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { AdminStatsResult, DailyTrendItem } from '#shared/types/adminStats'
import type { AlertEventSummary } from '#shared/types/alertEvents'
import { useAdminStats, useAdminAlertEvents, useChartResize } from '~/composables/admin'

use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer])

definePageMeta({ layout: 'admin' })

// ============ 数据获取 ============

const days = ref(7)
const { isLoading, execute } = useAdminStats()
const statsData = ref<AdminStatsResult | null>(null)

// 告警事件（近 1 小时；独立接口独立加载，不随 days 切换重拉）
const { execute: executeAlertEvents } = useAdminAlertEvents()
const alertEvents = ref<AlertEventSummary | null>(null)

/** 告警事件来源标签（键与 shared ALERT_EVENT_SOURCES 一致） */
const EVENT_SOURCE_LABELS: Record<string, string> = {
  client_error: '前端错误',
  log_queue: '埋点队列',
  task_fail: '任务失败',
  cloud_health: '云健康',
  security: '安全事件',
}

function formatEventTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function loadAlertEvents() {
  const res = await executeAlertEvents(null, { silent: true })
  if (res?.code === 200 && res.data) {
    alertEvents.value = res.data
  }
}

const hasData = computed(() => (statsData.value?.summary.totalCalls ?? 0) > 0)

async function fetchStats() {
  const res = await execute({ days: days.value })
  if (res.code === 200 && res.data) {
    statsData.value = res.data
    updateCharts()
  }
  // 手动刷新/切换天数时同步刷新告警事件（60s 缓存兜底，事件低频变化）
  await loadAlertEvents()
}

/** 指标带配置（直接使用 statsData 原始值） */
const metricCells = computed(() => {
  const s = statsData.value?.summary
  if (!s) return []
  return [
    {
      label: '今日调用',
      display: s.todayCalls.toLocaleString(),
      unit: '次',
      sub: '当日 0 时至今',
      tone: 'blue',
    },
    {
      label: '总调用量',
      display: s.totalCalls.toLocaleString(),
      unit: '次',
      sub: `近 ${days.value} 天`,
      tone: 'blue',
    },
    {
      label: '错误率',
      display: s.errorRate.toFixed(2),
      unit: '%',
      sub: s.errorRate > 5 ? '高于 5%，需关注' : '运行平稳',
      tone: s.errorRate > 5 ? 'red' : 'green',
    },
    {
      label: '平均耗时',
      display: s.avgDuration.toLocaleString(),
      unit: 'ms',
      sub: '全接口均值',
      tone: 'orange',
    },
    {
      label: '活跃用户',
      display: s.activeUsers.toLocaleString(),
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

// 容器尺寸变化时自适应（侧边栏固定，主内容区随窗口变化），卸载时统一 dispose
useChartResize([
  { getChart: () => trendChart, containerRef: trendChartRef },
  { getChart: () => topChart, containerRef: topChartRef },
])

const maxErrorCount = computed(() =>
  Math.max(1, ...(statsData.value?.errorPaths.map((i) => i.count) ?? [1])),
)

function barWidth(count: number, max: number) {
  return `${Math.max(4, (count / max) * 100)}%`
}

/** 错误路径 → API 调用日志页（path 作为路径关键词预填筛选） */
function goApiCallLog(path: string) {
  navigateTo(`/admin/logs/api-call?path=${encodeURIComponent(path)}`)
}

/** 补齐无数据日期为 0，保证趋势轴连续 */
function fillTrendGap(trend: DailyTrendItem[], range: number): DailyTrendItem[] {
  const map = new Map(trend.map((i) => [i.date, i]))
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
  const dates = trend.map((i) => i.date.slice(5)) // MM-DD 展示更紧凑
  trendChart.setOption({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#ebeef5',
      textStyle: { color: '#303133', fontSize: 12 },
      formatter(params: { dataIndex: number; color: string; seriesName: string; value: number }[]) {
        const full = trend[params[0]!.dataIndex]!
        const lines = params.map(
          (p) =>
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>${p.seriesName}：<b>${p.value.toLocaleString()}</b>`,
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
        data: trend.map((i) => i.count),
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
        data: trend.map((i) => i.errorCount),
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
      formatter(params: { dataIndex: number }[]) {
        const item = items[params[0]!.dataIndex]!
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
      data: items.map((i) => i.path),
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
        data: items.map((i) => i.count),
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
          formatter: (p: { value: number }) => p.value.toLocaleString(),
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
}

onMounted(() => {
  initCharts()
  fetchStats()
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
  0% {
    transform: scale(0.6);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.6);
    opacity: 0;
  }
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
.metric-cell--blue::before {
  background: var(--primary);
}
.metric-cell--green::before {
  background: var(--success);
}
.metric-cell--red::before {
  background: var(--danger);
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
  font-size: 30px;
  font-weight: 700;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.metric-cell--red .metric-value {
  color: var(--danger);
}
.metric-cell--green .metric-value {
  color: var(--success);
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
.metric-cell--red .metric-sub {
  color: var(--danger);
  opacity: 0.8;
}

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
.legend-chip--calls::before {
  background: var(--primary);
}
.legend-chip--errors::before {
  background: var(--danger);
}

.chart-body {
  width: 100%;
}
.chart-body--trend {
  height: 300px;
}
.chart-body--top {
  height: 300px;
}

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

.error-path--link {
  cursor: pointer;
  transition: color 0.2s;
}
.error-path--link:hover {
  color: var(--primary);
  text-decoration: underline;
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

/* ===== 右列堆叠（安全视角） ===== */
.right-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* ===== 告警事件（近 1 小时，全宽） ===== */
.events-link {
  margin-left: 8px;
  font-size: 12px;
}

.events-counts {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.event-count-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 76px;
  padding: 8px 10px;
  background: var(--bg);
  border-radius: 8px;
}

.event-count-label {
  font-size: 12px;
  color: var(--text-3);
}

.event-count-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.event-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  overflow: hidden;
}

.event-code {
  font-family: 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-2);
  flex-shrink: 0;
}

.event-msg {
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.event-time {
  font-size: 12px;
  color: var(--text-3);
  flex-shrink: 0;
}

.num-warning {
  color: var(--warning, #e6a23c);
  font-weight: 600;
}

/* ===== 响应式（PC 宽屏优先，窄屏兜底） ===== */
@media (max-width: 1100px) {
  .metric-band {
    grid-template-columns: repeat(3, 1fr);
  }
  .metric-cell:nth-child(4) {
    border-left: none;
  }
  .chart-grid,
  .sub-grid {
    grid-template-columns: 1fr;
  }
}
</style>
