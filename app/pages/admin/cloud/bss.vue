<!-- app/pages/admin/cloud/bss.vue：BSS 费用中心（账户余额 + 账单明细） -->
<template>
  <div class="cloud-page" v-loading="isLoading">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">BSS 费用中心</h2>
        <p class="page-desc">阿里云账户余额 + 账单明细查询</p>
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
          <el-table v-if="data.bill.items?.length" :data="data.bill.items" stripe size="small" max-height="320">
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
          <p class="bill-total" v-if="data.bill.items?.length">
            共 {{ data.bill.totalCount ?? data.bill.items.length }} 条 ·
            实付合计 ￥{{ totalPayment }}
          </p>
        </template>
        <div v-else class="unavailable">
          <el-icon :size="22"><WarningFilled /></el-icon>
          <p>账单暂不可用</p>
          <span>{{ data?.bill.error || '加载失败或未配置' }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import type { BssStatResult } from '#shared/types/adminCloud'
import { useAdminCloudBss } from '~/composables/admin'

definePageMeta({ layout: 'admin' })

// 默认当月
const now = new Date()
const billingMonth = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)

const { isLoading, execute } = useAdminCloudBss()
const data = ref<BssStatResult | null>(null)

/** 实付合计 */
const totalPayment = computed(() => {
  const items = data.value?.bill.items ?? []
  return items.reduce((sum, i) => sum + i.paymentAmount, 0).toFixed(2)
})

async function fetchData() {
  const res = await execute({ billingCycle: billingMonth.value })
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

.content-grid { display: grid; grid-template-columns: 2fr 3fr; gap: 16px; }
.panel { background: var(--card); border-radius: var(--r-lg); box-shadow: var(--shadow); padding: 18px 20px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.panel-note { font-size: 12px; color: var(--text-4); }
.path-code { font-family: 'Cascadia Code', 'Consolas', monospace; font-size: 12px; background: var(--bg); padding: 2px 6px; border-radius: 4px; }

/* 余额卡片 */
.balance-body { display: flex; flex-direction: column; gap: 14px; }
.balance-hero { display: flex; flex-direction: column; align-items: center; padding: 12px 0 4px; gap: 4px; }
.balance-number { font-size: 36px; font-weight: 700; color: var(--primary-dark); font-variant-numeric: tabular-nums; line-height: 1; }
.balance-caption { font-size: 12px; color: var(--text-3); }
.balance-rows { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: var(--primary-light); border-radius: var(--r); }
.balance-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-2); }
.balance-row b { font-variant-numeric: tabular-nums; color: var(--text-1); }

/* 账单 */
.bill-total { margin-top: 12px; font-size: 12px; color: var(--text-3); text-align: right; }

/* 降级态 */
.unavailable { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px 16px; color: var(--text-4); text-align: center; }
.unavailable p { font-size: 13px; font-weight: 600; color: var(--text-3); }
.unavailable span { font-size: 12px; word-break: break-all; }

@media (max-width: 1100px) {
  .content-grid { grid-template-columns: 1fr; }
}
</style>
