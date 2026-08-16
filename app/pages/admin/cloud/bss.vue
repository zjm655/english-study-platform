<!-- app/pages/admin/cloud/bss.vue：BSS 费用中心（余额 + 账单 + 总览 + 代金券/预付卡 + 月度趋势） -->
<template>
  <div v-loading="isLoading" class="cloud-page">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">BSS 费用中心</h2>
        <p class="page-desc">阿里云账户余额 · 账单明细 · 账单总览 · 代金券/预付卡 · 月度趋势</p>
      </div>
      <div class="header-actions">
        <el-date-picker
          v-model="billingMonth"
          type="month"
          placeholder="选择账期"
          format="YYYY-MM"
          value-format="YYYY-MM"
          :clearable="false"
          @change="fetchData"
        />
        <el-tooltip content="刷新" placement="top">
          <el-button :icon="Refresh" circle @click="fetchData" />
        </el-tooltip>
      </div>
    </div>

    <div class="content-grid">
      <!-- 余额卡片 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">账户余额</h3>
          <span class="panel-note">QueryAccountBalance</span>
        </header>
        <div v-if="data?.balance.success" class="balance-body">
          <div class="balance-hero">
            <span class="balance-number">￥{{ data.balance.availableAmount ?? '--' }}</span>
            <span class="balance-caption">可用额度（{{ data.balance.currency ?? 'CNY' }}）</span>
          </div>
          <div class="balance-rows">
            <div class="balance-row">
              <span>可用现金</span><b>￥{{ data.balance.availableCashAmount ?? '--' }}</b>
            </div>
            <div class="balance-row">
              <span>信用额度</span><b>￥{{ data.balance.creditAmount ?? '--' }}</b>
            </div>
          </div>
        </div>
        <div v-else class="unavailable">
          <el-icon :size="22"><WarningFilled /></el-icon>
          <p>余额暂不可用</p>
          <span>{{ data?.balance.error || '加载失败或未配置' }}</span>
        </div>
      </section>

      <!-- 账单明细 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">账单明细</h3>
          <span class="panel-note">{{ billingMonth }} 账期</span>
        </header>
        <template v-if="data?.bill.success">
          <el-table
            v-if="data.bill.items?.length"
            :data="data.bill.items"
            stripe
            size="small"
            max-height="320"
          >
            <el-table-column prop="productName" label="产品" min-width="140" />
            <el-table-column prop="productCode" label="产品代码" width="110">
              <template #default="{ row }">
                <code class="path-code">{{ row.productCode }}</code>
              </template>
            </el-table-column>
            <el-table-column prop="subscriptionType" label="付费类型" width="100">
              <template #default="{ row }">
                {{ row.subscriptionType === 'Subscription' ? '预付费' : '后付费' }}
              </template>
            </el-table-column>
            <el-table-column prop="pretaxAmount" label="应付(元)" width="100" align="right">
              <template #default="{ row }">￥{{ row.pretaxAmount.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column prop="deductedByCoupons" label="优惠券抵扣" width="110" align="right">
              <template #default="{ row }">￥{{ row.deductedByCoupons.toFixed(2) }}</template>
            </el-table-column>
            <el-table-column prop="paymentAmount" label="实付(元)" width="100" align="right">
              <template #default="{ row }">
                <b>￥{{ row.paymentAmount.toFixed(2) }}</b>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="该账期无账单记录" :image-size="64" />
          <p v-if="data.bill.items?.length" class="bill-total">
            共 {{ data.bill.totalCount ?? data.bill.items.length }} 条 · 实付合计 ￥{{
              totalPayment
            }}
          </p>
        </template>
        <div v-else class="unavailable">
          <el-icon :size="22"><WarningFilled /></el-icon>
          <p>账单暂不可用</p>
          <span>{{ data?.bill.error || '加载失败或未配置' }}</span>
        </div>
      </section>
    </div>

    <!-- 账单总览（按产品） -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">账单总览</h3>
        <span class="panel-note">{{ billingMonth }} · 按产品汇总（应付 = 实付 + 优惠券抵扣）</span>
      </header>
      <template v-if="data?.billOverview.success">
        <div v-if="hasOverview" class="overview-summary">
          <div class="overview-summary__cell">
            <span class="overview-summary__label">应付合计</span>
            <b class="overview-summary__value">￥{{ overviewTotals.pretax }}</b>
          </div>
          <div class="overview-summary__cell overview-summary__cell--coupon">
            <span class="overview-summary__label">优惠券抵扣</span>
            <b class="overview-summary__value">-￥{{ overviewTotals.deducted }}</b>
          </div>
          <div class="overview-summary__cell">
            <span class="overview-summary__label">实付合计</span>
            <b class="overview-summary__value">￥{{ overviewTotals.payment }}</b>
          </div>
        </div>
        <div v-show="hasOverview" ref="overviewChartRef" class="overview-chart"></div>
        <div v-show="hasOverview" ref="overviewBarRef" class="overview-bar"></div>
        <el-empty v-if="!hasOverview" description="该账期无消费记录" :image-size="64" />
      </template>
      <div v-else class="unavailable">
        <el-icon :size="22"><WarningFilled /></el-icon>
        <p>账单总览暂不可用</p>
        <span>{{ data?.billOverview.error || '加载失败或未配置' }}</span>
      </div>
    </section>

    <!-- 月度消费趋势 -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">月度消费趋势</h3>
        <span class="panel-note">近 6 个月实付金额</span>
      </header>
      <template v-if="data?.monthlyTrend.success">
        <div v-show="hasTrend" ref="trendChartRef" class="trend-chart"></div>
        <el-empty v-if="!hasTrend" description="暂无趋势数据" :image-size="64" />
      </template>
      <div v-else class="unavailable">
        <el-icon :size="22"><WarningFilled /></el-icon>
        <p>趋势数据暂不可用</p>
        <span>{{ data?.monthlyTrend.error || '加载失败或未配置' }}</span>
      </div>
    </section>

    <!-- 代金券 / 预付卡 -->
    <div class="content-grid content-grid--even">
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">代金券余额</h3>
          <span class="panel-note">QueryCashCoupons</span>
        </header>
        <template v-if="data?.coupons.success">
          <el-table
            v-if="data.coupons.items?.length"
            :data="data.coupons.items"
            stripe
            size="small"
            max-height="280"
          >
            <el-table-column prop="nominalValue" label="面额" width="80" align="right">
              <template #default="{ row }">￥{{ row.nominalValue }}</template>
            </el-table-column>
            <el-table-column prop="balance" label="余额" width="80" align="right">
              <template #default="{ row }">
                <b>￥{{ row.balance }}</b>
              </template>
            </el-table-column>
            <el-table-column
              prop="applicableProducts"
              label="适用产品"
              min-width="110"
              show-overflow-tooltip
            />
            <el-table-column prop="expiryTime" label="到期" width="110" />
          </el-table>
          <el-empty v-else description="无可用代金券" :image-size="64" />
        </template>
        <div v-else class="unavailable">
          <el-icon :size="22"><WarningFilled /></el-icon>
          <p>代金券暂不可用</p>
          <span>{{ data?.coupons.error || '加载失败或未配置' }}</span>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">预付卡余额</h3>
          <span class="panel-note">QueryPrepaidCards</span>
        </header>
        <template v-if="data?.prepaidCards.success">
          <el-table
            v-if="data.prepaidCards.items?.length"
            :data="data.prepaidCards.items"
            stripe
            size="small"
            max-height="280"
          >
            <el-table-column prop="nominalValue" label="面额" width="80" align="right">
              <template #default="{ row }">￥{{ row.nominalValue }}</template>
            </el-table-column>
            <el-table-column prop="balance" label="余额" width="80" align="right">
              <template #default="{ row }">
                <b>￥{{ row.balance }}</b>
              </template>
            </el-table-column>
            <el-table-column
              prop="applicableProducts"
              label="适用产品"
              min-width="110"
              show-overflow-tooltip
            />
            <el-table-column prop="expiryTime" label="到期" width="110" />
          </el-table>
          <el-empty v-else description="无可用预付卡" :image-size="64" />
        </template>
        <div v-else class="unavailable">
          <el-icon :size="22"><WarningFilled /></el-icon>
          <p>预付卡暂不可用</p>
          <span>{{ data?.prepaidCards.error || '加载失败或未配置' }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import { use, init } from 'echarts/core'
import { PieChart, LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { BssStatResult } from '#shared/types/adminCloud'
import { useAdminCloudBss, useChartResize, buildLineChartOption } from '~/composables/admin'

use([
  PieChart,
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
])

definePageMeta({ layout: 'admin' })

// 默认当月
const now = new Date()
const billingMonth = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)

const { isLoading, execute } = useAdminCloudBss()
const data = ref<BssStatResult | null>(null)

// 图表
const overviewChartRef = ref<HTMLElement | null>(null)
let overviewChart: EChartsType | null = null
const overviewBarRef = ref<HTMLElement | null>(null)
let overviewBarChart: EChartsType | null = null
const trendChartRef = ref<HTMLElement | null>(null)
let trendChart: EChartsType | null = null

// 容器尺寸变化时自适应（三图共用单个 ResizeObserver），卸载时统一 dispose
useChartResize([
  { getChart: () => overviewChart, containerRef: overviewChartRef },
  { getChart: () => overviewBarChart, containerRef: overviewBarRef },
  { getChart: () => trendChart, containerRef: trendChartRef },
])

const hasOverview = computed(() => (data.value?.billOverview.items?.length ?? 0) > 0)
const hasTrend = computed(() => (data.value?.monthlyTrend.items?.length ?? 0) > 0)

/** 账单总览汇总（应付 / 优惠券抵扣 / 实付） */
const overviewTotals = computed(() => {
  const items = data.value?.billOverview.items ?? []
  const fixed = (n: number) => n.toFixed(2)
  return {
    pretax: fixed(items.reduce((s, i) => s + i.pretaxAmount, 0)),
    deducted: fixed(items.reduce((s, i) => s + i.deductedByCoupons, 0)),
    payment: fixed(items.reduce((s, i) => s + i.paymentAmount, 0)),
  }
})

/** 实付合计 */
const totalPayment = computed(() => {
  const items = data.value?.bill.items ?? []
  return items.reduce((sum, i) => sum + i.paymentAmount, 0).toFixed(2)
})

async function fetchData() {
  const res = await execute({ billingCycle: billingMonth.value })
  if (res.code === 200 && res.data) {
    data.value = res.data
    await nextTick()
    renderOverviewChart()
    renderOverviewBar()
    renderTrendChart()
  }
}

function renderOverviewChart() {
  if (!overviewChartRef.value || !hasOverview.value) return
  if (!overviewChart) overviewChart = init(overviewChartRef.value)
  const items = data.value!.billOverview.items!
  overviewChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: ￥{c} ({d}%)' },
    legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
    series: [
      {
        name: '实付金额',
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { fontSize: 11 },
        data: items.map((i) => ({ name: i.productName, value: i.paymentAmount })),
      },
    ],
  })
}

function renderOverviewBar() {
  if (!overviewBarRef.value || !hasOverview.value) return
  if (!overviewBarChart) overviewBarChart = init(overviewBarRef.value)
  const items = data.value!.billOverview.items!
  overviewBarChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 55, right: 20, top: 20, bottom: 45 },
    xAxis: {
      type: 'category',
      data: items.map((i) => i.productName),
      axisLabel: { fontSize: 11, interval: 0, rotate: items.length > 4 ? 25 : 0 },
    },
    yAxis: {
      type: 'value',
      name: '金额(元)',
      axisLabel: { fontSize: 11 },
      splitLine: { show: false },
    },
    series: [
      {
        name: '实付',
        type: 'bar',
        stack: 'total',
        data: items.map((i) => i.paymentAmount),
        itemStyle: { color: '#409eff' },
      },
      {
        name: '优惠券抵扣',
        type: 'bar',
        stack: 'total',
        data: items.map((i) => i.deductedByCoupons),
        itemStyle: { color: '#e6a23c' },
      },
    ],
  })
}

function renderTrendChart() {
  if (!trendChartRef.value || !hasTrend.value) return
  if (!trendChart) trendChart = init(trendChartRef.value)
  const items = data.value!.monthlyTrend.items!
  // P4-D4：折线 option 收敛到 buildLineChartOption 工厂（TECH_DEBT #3；Pie/Bar 保留页面内）
  trendChart.setOption(
    buildLineChartOption({
      xData: items.map((i) => i.billingCycle),
      yName: '实付(元)',
      series: [{ name: '实付金额', data: items.map((i) => i.paymentAmount), color: '#67C23A' }],
      overrides: {
        grid: { left: 55, right: 20, top: 20, bottom: 30 },
        xAxis: {
          type: 'category',
          data: items.map((i) => i.billingCycle),
          axisLabel: { fontSize: 11 },
        },
      },
    }),
  )
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

.content-grid {
  display: grid;
  grid-template-columns: 2fr 3fr;
  gap: 16px;
}
.content-grid--even {
  grid-template-columns: 1fr 1fr;
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

/* 图表 */
.overview-summary {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}
.overview-summary__cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  background: var(--bg);
  border-radius: var(--r);
}
.overview-summary__label {
  font-size: 12px;
  color: var(--text-3);
}
.overview-summary__value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.overview-summary__cell--coupon .overview-summary__value {
  color: #e6a23c;
}
.overview-chart {
  width: 100%;
  height: 300px;
}
.overview-bar {
  width: 100%;
  height: 300px;
  margin-top: 8px;
}
.trend-chart {
  width: 100%;
  height: 280px;
}

/* 余额卡片 */
.balance-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.balance-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0 4px;
  gap: 4px;
}
.balance-number {
  font-size: 36px;
  font-weight: 700;
  color: var(--primary-dark);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.balance-caption {
  font-size: 12px;
  color: var(--text-3);
}
.balance-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background: var(--primary-light);
  border-radius: var(--r);
}
.balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
}
.balance-row b {
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

/* 账单 */
.bill-total {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-3);
  text-align: right;
}

/* 降级态 */
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

@media (max-width: 1100px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

/* 平板/窄屏：头部与概览改纵向堆叠，面板内边距收紧 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .header-actions {
    flex-wrap: wrap;
  }
  .overview-summary {
    flex-direction: column;
  }
  .panel {
    padding: 16px 14px;
  }
  .page-title {
    font-size: 18px;
  }
}

/* 手机端：图表高度与余额大字号适当缩减 */
@media (max-width: 480px) {
  .overview-chart,
  .overview-bar {
    height: 220px;
  }
  .trend-chart {
    height: 220px;
  }
  .balance-number {
    font-size: 28px;
  }
}
</style>
