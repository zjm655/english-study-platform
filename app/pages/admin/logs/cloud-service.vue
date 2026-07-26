<script setup lang="ts">
import { useCloudServiceLogList, useCleanLogs, useTableSelection } from '~/composables/admin'
import { adminLogsExportPath } from '~/api/paths'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CloudServiceLogItem } from '#shared/types/adminLogs'

definePageMeta({ layout: 'admin', title: '云服务调用日志' })
useSeoMeta({ title: '云服务调用日志 - 管理后台' })

const { isLoading, execute } = useCloudServiceLogList()
const { execute: cleanLogsExec } = useCleanLogs()

// 筛选
const filterService = ref('')
const filterSuccess = ref<string>('') // '' / '1' / '0'
const filterOperationKeyword = ref('')
const filterStartDate = ref('')
const filterEndDate = ref('')

// 分页
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<CloudServiceLogItem[]>([])

// 批量选择（reserve-selection 跨页保留；选中行导出上限对齐后端 export ids=200）
const { tableRef, selectedRows, selectedIds, onSelectionChange, clear, canSelect, removeRow, offPageCount } =
  useTableSelection<CloudServiceLogItem>({ limit: 200, pageRows: () => list.value })

// 详情 Drawer
const detailVisible = ref(false)
const detailRow = ref<CloudServiceLogItem | null>(null)

// 清理
const cleaning = ref(false)
const cleanDays = ref(90)

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    service: filterService.value || undefined,
    success: filterSuccess.value !== '' ? Number(filterSuccess.value) : undefined,
    operationKeyword: filterOperationKeyword.value.trim() || undefined,
    startDate: filterStartDate.value || undefined,
    endDate: filterEndDate.value || undefined,
  })
  if (res?.code === 200 && res.data) {
    list.value = res.data.list
    total.value = res.data.total
  }
}

function handleSearch() {
  clear() // 筛选变更清空选择：被筛掉的选中行不可见，保留即幽灵选中
  page.value = 1
  loadList()
}

function handleReset() {
  clear()
  filterService.value = ''
  filterSuccess.value = ''
  filterOperationKeyword.value = ''
  filterStartDate.value = ''
  filterEndDate.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

function showDetail(row: CloudServiceLogItem) {
  detailRow.value = row
  detailVisible.value = true
}

function handleExport() {
  const params = new URLSearchParams()
  params.append('table', 'cloud_service_call_log')
  if (filterStartDate.value) params.append('startDate', filterStartDate.value)
  if (filterEndDate.value) params.append('endDate', filterEndDate.value)
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

function handleExportSelected() {
  const params = new URLSearchParams()
  params.append('table', 'cloud_service_call_log')
  params.append('ids', selectedIds.value.join(','))
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

async function handleClean() {
  try {
    await ElMessageBox.confirm(
      `确定要清理 ${cleanDays.value} 天前的「云服务调用日志」吗？此操作不可恢复。`,
      '清理确认',
      { type: 'warning', confirmButtonText: '确定清理', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  cleaning.value = true
  try {
    const res = await cleanLogsExec({ table: 'cloud_service_call_log', days: cleanDays.value })
    if (res.code === 200) {
      ElMessage.success(res.message ?? `已清理 ${res.data?.deletedRows ?? 0} 条记录`)
      loadList()
    } else {
      ElMessage.error(res.message ?? '清理失败')
    }
  } finally {
    cleaning.value = false
  }
}

type TagType = 'primary' | 'success' | 'info' | 'warning' | 'danger'

function serviceTagType(s: string): TagType {
  const map: Record<string, TagType> = {
    deepseek: 'primary',
    oss: 'success',
    nls: 'warning',
    tts: 'info',
    bss: 'danger',
    aiContent: 'primary',
  }
  return map[s] ?? 'info'
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
  <div class="cloud-service-log-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">云服务调用日志</h2>
        <p class="page-desc">查看 DeepSeek / OSS / NLS / TTS / BSS / 智能科教等云服务的调用记录</p>
      </div>
    </div>

    <!-- 操作栏 -->
    <el-card class="action-card" shadow="never">
      <div class="action-bar">
        <el-button type="primary" @click="handleExport">导出 CSV（最近 5 万条）</el-button>
        <el-divider direction="vertical" />
        <span class="clean-label">清理</span>
        <el-input-number
          v-model="cleanDays"
          :min="7"
          :max="365"
          :step="30"
          style="width: 120px"
        />
        <span class="clean-label">天前的数据</span>
        <el-button type="danger" :loading="cleaning" @click="handleClean">执行清理</el-button>
      </div>
    </el-card>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-select
          v-model="filterService"
          class="filter-item"
          clearable
          placeholder="服务"
        >
          <el-option label="全部" value="" />
          <el-option label="DeepSeek" value="deepseek" />
          <el-option label="TTS" value="tts" />
          <el-option label="OSS" value="oss" />
          <el-option label="NLS" value="nls" />
          <el-option label="BSS" value="bss" />
          <el-option label="智能科教" value="aiContent" />
        </el-select>
        <el-select
          v-model="filterSuccess"
          class="filter-item"
          clearable
          placeholder="调用结果"
        >
          <el-option label="全部" value="" />
          <el-option label="成功" value="1" />
          <el-option label="失败" value="0" />
        </el-select>
        <el-input
          v-model="filterOperationKeyword"
          placeholder="操作关键词"
          clearable
          class="filter-item"
          @keyup.enter="handleSearch"
        />
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
      <AdminBatchBar
        :count="selectedRows.length"
        :off-page-count="offPageCount"
        :rows="selectedRows"
        :row-label="(r) => r.operation"
        @clear="clear"
        @remove="removeRow"
      >
        <el-button type="primary" size="small" @click="handleExportSelected">导出选中</el-button>
      </AdminBatchBar>

      <el-table
        ref="tableRef"
        v-loading="isLoading"
        :data="list"
        stripe
        row-key="id"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="46" reserve-selection :selectable="canSelect" />
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="service" label="Service" width="120">
          <template #default="{ row }">
            <el-tag :type="serviceTagType(row.service)" size="small">{{ row.service }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operation" label="Operation" min-width="180" show-overflow-tooltip />
        <el-table-column prop="success" label="Success" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'info'" size="small">
              {{ row.success ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="Duration" width="100" align="center">
          <template #default="{ row }">{{ row.durationMs }}ms</template>
        </el-table-column>
        <el-table-column prop="promptTokens" label="PromptTokens" width="120" align="center">
          <template #default="{ row }">{{ row.promptTokens ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="completionTokens" label="CompletionTokens" width="140" align="center">
          <template #default="{ row }">{{ row.completionTokens ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="totalTokens" label="TotalTokens" width="110" align="center">
          <template #default="{ row }">{{ row.totalTokens ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="errorMessage" label="ErrorMessage" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tooltip
              v-if="row.errorMessage"
              :content="row.errorMessage"
              placement="top"
              :show-after="300"
            >
              <span class="error-msg">{{ row.errorMessage }}</span>
            </el-tooltip>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showDetail(row as CloudServiceLogItem)">查看详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无日志记录" :image-size="80" />
        </template>
      </el-table>

      <div class="pagination-row">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="loadList"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 详情 Drawer -->
    <el-drawer v-model="detailVisible" direction="rtl" size="40%" title="云服务调用日志详情">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="Service">
          <el-tag :type="serviceTagType(detailRow.service)" size="small">{{ detailRow.service }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="Operation">{{ detailRow.operation }}</el-descriptions-item>
        <el-descriptions-item label="Success">
          <el-tag :type="detailRow.success ? 'success' : 'info'" size="small">
            {{ detailRow.success ? '是' : '否' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="DurationMs">{{ detailRow.durationMs }}ms</el-descriptions-item>
        <el-descriptions-item label="PromptTokens">{{ detailRow.promptTokens ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="CompletionTokens">{{ detailRow.completionTokens ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="TotalTokens">{{ detailRow.totalTokens ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="ErrorMessage">
          <span v-if="detailRow.errorMessage" class="error-msg">{{ detailRow.errorMessage }}</span>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="CreatedAt">{{ formatDate(detailRow.createdAt) }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.cloud-service-log-page {
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

.action-card {
  margin-bottom: 16px;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.clean-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
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
  width: 180px;
}

.filter-item--date {
  width: 160px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.error-msg {
  color: var(--el-color-danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
  max-width: 100%;
}

.text-muted {
  color: var(--el-text-color-secondary);
}
</style>
