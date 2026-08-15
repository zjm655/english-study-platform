<!-- app/pages/admin/logs/events.vue：告警事件浏览（A1）
     alert_event 表只读浏览：前端错误 / 埋点队列丢弃 / 任务失败 / 云失败率骤升 / 安全事件，
     未来告警通道的数据源。只读，不含清理操作。 -->
<script setup lang="ts">
import { useAlertEventList } from '~/composables/admin'
import type { AlertEventItem, AlertEventListQuery } from '#shared/types/adminLogs'

definePageMeta({ layout: 'admin', title: '告警事件' })
useSeoMeta({ title: '告警事件 - 管理后台' })

const { isLoading, execute } = useAlertEventList()

const filterSource = ref<'' | NonNullable<AlertEventListQuery['source']>>('')
const filterLevel = ref<'' | NonNullable<AlertEventListQuery['level']>>('')
const filterStartDate = ref('')
const filterEndDate = ref('')

const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<AlertEventItem[]>([])

// 详情弹层（context JSON）
const detailVisible = ref(false)
const detailRow = ref<AlertEventItem | null>(null)

const SOURCE_LABELS: Record<string, string> = {
  client_error: '前端错误',
  log_queue: '埋点队列',
  task_fail: '任务失败',
  cloud_health: '云健康',
  security: '安全事件',
}

function sourceTagType(source: string) {
  return ({ client_error: 'warning', task_fail: 'danger', cloud_health: 'danger', security: 'danger', log_queue: 'info' } as const)[source] ?? 'info'
}

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    source: filterSource.value || undefined,
    level: filterLevel.value || undefined,
    startDate: filterStartDate.value || undefined,
    endDate: filterEndDate.value || undefined,
  })
  if (res?.code === 200 && res.data) {
    list.value = res.data.list
    total.value = res.data.total
  }
}

function handleSearch() {
  page.value = 1
  loadList()
}

function handleReset() {
  filterSource.value = ''
  filterLevel.value = ''
  filterStartDate.value = ''
  filterEndDate.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

function showDetail(row: AlertEventItem) {
  detailRow.value = row
  detailVisible.value = true
}

function formatDate(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

onMounted(() => {
  loadList()
})
</script>

<template>
  <div class="events-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">告警事件</h2>
        <p class="page-desc">
          前端错误 / 埋点队列丢弃 / 任务失败 / 云失败率骤升 / 安全事件的统一数据源（alert_event），未来告警通道直接消费
        </p>
      </div>
    </div>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-select v-model="filterSource" class="filter-item" clearable placeholder="事件来源" @change="handleSearch">
          <el-option label="全部" value="" />
          <el-option v-for="(label, value) in SOURCE_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <el-select v-model="filterLevel" class="filter-item filter-item--narrow" clearable placeholder="级别" @change="handleSearch">
          <el-option label="全部" value="" />
          <el-option label="错误" value="error" />
          <el-option label="警告" value="warn" />
        </el-select>
        <el-date-picker
          v-model="filterStartDate"
          type="date"
          placeholder="开始日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          class="filter-item filter-item--date"
        />
        <el-date-picker
          v-model="filterEndDate"
          type="date"
          placeholder="结束日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          class="filter-item filter-item--date"
        />
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card class="table-card" shadow="never">
      <el-table v-loading="isLoading" :data="list" stripe row-key="id" size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="来源" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="sourceTagType(row.source)" size="small">
              {{ SOURCE_LABELS[row.source] ?? row.source }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="级别" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.level === 'error' ? 'danger' : 'warning'" size="small" effect="plain">
              {{ row.level === 'error' ? '错误' : '警告' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="事件码" width="150">
          <template #default="{ row }">
            <code class="code-text">{{ row.code || '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="消息" min-width="220" show-overflow-tooltip />
        <el-table-column prop="requestId" label="RequestId" width="90" align="center">
          <template #default="{ row }">
            <span class="text-muted">{{ row.requestId || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="userId" label="UserId" width="80" align="center">
          <template #default="{ row }">{{ row.userId ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showDetail(row as AlertEventItem)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无事件记录" :image-size="80" />
        </template>
      </el-table>

      <div class="pagination-row">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          size="small"
          @current-change="loadList"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 详情 Drawer -->
    <el-drawer v-model="detailVisible" direction="rtl" size="40%" title="告警事件详情">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="来源">
          <el-tag :type="sourceTagType(detailRow.source)" size="small">
            {{ SOURCE_LABELS[detailRow.source] ?? detailRow.source }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="级别">{{ detailRow.level }}</el-descriptions-item>
        <el-descriptions-item label="事件码">{{ detailRow.code || '-' }}</el-descriptions-item>
        <el-descriptions-item label="消息">{{ detailRow.message || '-' }}</el-descriptions-item>
        <el-descriptions-item label="RequestId">{{ detailRow.requestId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="UserId">{{ detailRow.userId ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="上下文">
          <pre v-if="detailRow.context" class="admin-pre-text">{{ JSON.stringify(detailRow.context, null, 2) }}</pre>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="时间">{{ formatDate(detailRow.createdAt) }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.events-page {
  width: 100%;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 6px;
}

.page-desc {
  font-size: 14px;
  color: var(--text-3);
}

.filter-card {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-item {
  width: 160px;
}

.filter-item--narrow {
  width: 120px;
}

.filter-item--date {
  width: 160px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.code-text {
  font-family: 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  background: var(--bg);
  padding: 2px 6px;
  border-radius: 4px;
}

.text-muted {
  color: var(--text-3);
}
</style>
