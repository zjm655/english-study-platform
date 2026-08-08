<!-- app/pages/admin/cloud/oss.vue：OSS 对象存储用量（本地埋点估算 + 官方 GetBucketStat） -->
<template>
  <div v-loading="isLoading" class="cloud-page">
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
        <span class="metric-value"
          >{{ data?.estimate.totalCalls.toLocaleString() ?? '--'
          }}<i class="metric-unit">次</i></span
        >
        <span class="metric-sub">近 {{ days }} 天上传请求</span>
      </div>
      <div class="metric-cell metric-cell--orange">
        <span class="metric-label">估算费用</span>
        <span class="metric-value"
          >￥{{ data?.estimate.totalEstimatedCost.toFixed(3) ?? '--' }}</span
        >
        <span class="metric-sub">单价 ￥{{ data?.estimate.unitPrice ?? 0 }}/次</span>
      </div>
      <div class="metric-cell metric-cell--green">
        <span class="metric-label">存储容量</span>
        <span class="metric-value">{{ formatBytes(data?.bucketStat.storage) }}</span>
        <span class="metric-sub">官方 GetBucketStat</span>
      </div>
      <div class="metric-cell metric-cell--blue">
        <span class="metric-label">Object 数量</span>
        <span class="metric-value">{{
          data?.bucketStat.objectCount?.toLocaleString() ?? '--'
        }}</span>
        <span class="metric-sub">含材料音频 + 用户录音</span>
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

    <div class="content-grid">
      <!-- 本地估算面板 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">本地埋点估算明细</h3>
          <span class="panel-note">基于本地埋点统计</span>
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
          ⚠️ 基于本地埋点估算，仅供参考。上传（流入）内外网均免费、Put 请求费 0.01 元/万次；
          OSS 唯一实际成本是外网下行，即前端经签名 URL 直连播放——已由前端播放埋点统计（见
          「前端播放」行，按平均音频体积 1.5MB × 忙时价 0.50 元/GB 估算，实际闲时约半价），
          精确流量仍以官方 BSS 账单为准。
        </p>
      </section>

      <!-- 官方存储统计面板 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">官方存储统计</h3>
          <span class="panel-note">GetBucketStat · 非实时（延迟可能 &gt;1h）</span>
        </header>
        <div v-if="data?.bucketStat.success" class="bucket-stat-body">
          <div class="stat-row">
            <span>总存储量</span><b>{{ formatBytes(data.bucketStat.storage) }}</b>
          </div>
          <div class="stat-row">
            <span>Object 总数</span
            ><b>{{ data.bucketStat.objectCount?.toLocaleString() ?? '--' }}</b>
          </div>
          <div class="stat-row">
            <span>Multipart 残留</span
            ><b>{{ data.bucketStat.multipartUploadCount?.toLocaleString() ?? '0' }}</b>
          </div>
          <div v-if="data.bucketStat.lastModifiedTime" class="stat-row">
            <span>数据时间点</span><b>{{ formatTime(data.bucketStat.lastModifiedTime) }}</b>
          </div>
          <!-- 存储类型细分 -->
          <div class="stat-divider"></div>
          <div v-if="(data.bucketStat.standardStorage ?? 0) > 0" class="stat-row">
            <span>标准存储</span
            ><b
              >{{ formatBytes(data.bucketStat.standardStorage) }} /
              {{ data.bucketStat.standardObjectCount?.toLocaleString() ?? 0 }} 个</b
            >
          </div>
          <div
            v-if="(data.bucketStat.infrequentAccessStorage ?? 0) > 0"
            class="stat-row stat-row--dim"
          >
            <span>低频存储</span
            ><b
              >{{ formatBytes(data.bucketStat.infrequentAccessStorage) }} /
              {{ data.bucketStat.infrequentAccessObjectCount?.toLocaleString() ?? 0 }} 个</b
            >
          </div>
          <div v-if="(data.bucketStat.archiveStorage ?? 0) > 0" class="stat-row stat-row--dim">
            <span>归档存储</span
            ><b
              >{{ formatBytes(data.bucketStat.archiveStorage) }} /
              {{ data.bucketStat.archiveObjectCount?.toLocaleString() ?? 0 }} 个</b
            >
          </div>
          <div v-if="(data.bucketStat.coldArchiveStorage ?? 0) > 0" class="stat-row stat-row--dim">
            <span>冷归档</span
            ><b
              >{{ formatBytes(data.bucketStat.coldArchiveStorage) }} /
              {{ data.bucketStat.coldArchiveObjectCount?.toLocaleString() ?? 0 }} 个</b
            >
          </div>
          <div
            v-if="(data.bucketStat.deepColdArchiveStorage ?? 0) > 0"
            class="stat-row stat-row--dim"
          >
            <span>深度冷归档</span
            ><b
              >{{ formatBytes(data.bucketStat.deepColdArchiveStorage) }} /
              {{ data.bucketStat.deepColdArchiveObjectCount?.toLocaleString() ?? 0 }} 个</b
            >
          </div>
          <p class="traffic-note">
            ⚠️ 流量数据（内/外网收发）不在 GetBucketStat 中，需通过阿里云 BSS 账单或 CloudMonitor
            控制台查看
          </p>
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
import { use, graphic, init } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { OssStatResult } from '#shared/types/adminCloud'
import { useAdminCloudOss, useCloudTrend, useChartResize } from '~/composables/admin'

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

definePageMeta({ layout: 'admin' })

const days = ref(7)
const { isLoading, execute } = useAdminCloudOss()
const { isLoading: _trendLoading, execute: executeTrend } = useCloudTrend()
const data = ref<OssStatResult | null>(null)

// 趋势图
const trendChartRef = ref<HTMLElement | null>(null)
let trendChart: EChartsType | null = null

// 容器尺寸变化时自适应，卸载时统一 dispose
useChartResize([{ getChart: () => trendChart, containerRef: trendChartRef }])

async function fetchData() {
  const res = await execute({ days: days.value })
  if (res.code === 200 && res.data) {
    data.value = res.data
  }
  // 并行加载趋势数据
  const trendRes = await executeTrend({ service: 'oss', days: days.value })
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
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { fontSize: 11, formatter: (v: string) => (v.length >= 10 ? v.slice(5) : v) },
    },
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
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64,158,255,0.25)' },
            { offset: 1, color: 'rgba(64,158,255,0.02)' },
          ]),
        },
      },
      {
        name: '总耗时(ms)',
        type: 'line',
        yAxisIndex: 1,
        data: totalDurations,
        smooth: true,
        itemStyle: { color: '#E6A23C' },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(230,162,60,0.25)' },
            { offset: 1, color: 'rgba(230,162,60,0.02)' },
          ]),
        },
      },
    ],
  })
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '--'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '--'
  return new Date(timestamp * 1000).toLocaleString('zh-CN')
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
  grid-template-columns: repeat(4, 1fr);
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

.content-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
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

.bucket-stat-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  background: var(--primary-light);
  border-radius: var(--r);
}
.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
}
.stat-row b {
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}
.stat-row--dim {
  opacity: 0.7;
}
.stat-divider {
  height: 1px;
  background: var(--border-ll);
  margin: 4px 0;
}
.traffic-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.5;
}

.unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 16px;
  color: var(--text-4);
  text-align: center;
}
.unavailable p {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-3);
}
.unavailable span {
  font-size: 12px;
  word-break: break-all;
}

.trend-panel {
  margin-bottom: 0;
}
.trend-chart {
  width: 100%;
  height: 280px;
}

@media (max-width: 1100px) {
  .metric-band {
    grid-template-columns: repeat(2, 1fr);
  }
  .content-grid {
    grid-template-columns: 1fr;
  }
}
</style>
