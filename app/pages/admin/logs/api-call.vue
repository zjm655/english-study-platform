<script setup lang="ts">
import { useApiCallLogList } from '~/composables/admin'
import { adminLogsExportPath, adminLogsCleanPath } from '~/api/paths'
import { request } from '~/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ApiCallLogItem } from '#shared/types/adminLogs'

definePageMeta({ layout: 'admin', title: 'API 调用日志' })
useSeoMeta({ title: 'API 调用日志 - 管理后台' })

const { isLoading, execute } = useApiCallLogList()

// 筛选
const filterMethod = ref('')
const filterStatusCodeGroup = ref('')
const filterPathKeyword = ref('')
const filterUserId = ref<number | undefined>(undefined)
const filterStartDate = ref('')
const filterEndDate = ref('')

// 分页
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<ApiCallLogItem[]>([])

// 详情 Drawer
const detailVisible = ref(false)
const detailRow = ref<ApiCallLogItem | null>(null)

// 清理
const cleaning = ref(false)
const cleanDays = ref(90)

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    method: filterMethod.value || undefined,
    statusCodeGroup: (filterStatusCodeGroup.value as 'success' | '4xx' | '5xx') || undefined,
    pathKeyword: filterPathKeyword.value.trim() || undefined,
    userId: filterUserId.value || undefined,
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
  filterMethod.value = ''
  filterStatusCodeGroup.value = ''
  filterPathKeyword.value = ''
  filterUserId.value = undefined
  filterStartDate.value = ''
  filterEndDate.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

function showDetail(row: ApiCallLogItem) {
  detailRow.value = row
  detailVisible.value = true
}

function handleExport() {
  const params = new URLSearchParams()
  params.append('table', 'api_call_log')
  if (filterStartDate.value) params.append('startDate', filterStartDate.value)
  if (filterEndDate.value) params.append('endDate', filterEndDate.value)
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

async function handleClean() {
  try {
    await ElMessageBox.confirm(
      `确定要清理 ${cleanDays.value} 天前的「API 调用日志」吗？此操作不可恢复。`,
      '清理确认',
      { type: 'warning', confirmButtonText: '确定清理', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  cleaning.value = true
  try {
    const res = await request<{ deletedRows: number }>(adminLogsCleanPath, {
      method: 'POST',
      body: { table: 'api_call_log', days: cleanDays.value },
    })
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

function methodTagType(method: string) {
  switch (method) {
    case 'GET':
      return 'success'
    case 'POST':
      return 'primary'
    case 'PUT':
      return 'warning'
    case 'DELETE':
      return 'danger'
    default:
      return 'info'
  }
}

function statusTagType(code: number) {
  if (code < 400) return 'success'
  if (code < 500) return 'warning'
  return 'danger'
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
  <div class="api-call-log-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">API 调用日志</h2>
        <p class="page-desc">查看所有 /api 请求的调用记录，支持按方法、状态码、路径等筛选</p>
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
          v-model="filterMethod"
          class="filter-item"
          clearable
          placeholder="请求方法"
        >
          <el-option label="全部" value="" />
          <el-option label="GET" value="GET" />
          <el-option label="POST" value="POST" />
          <el-option label="PUT" value="PUT" />
          <el-option label="DELETE" value="DELETE" />
          <el-option label="PATCH" value="PATCH" />
        </el-select>
        <el-select
          v-model="filterStatusCodeGroup"
          class="filter-item"
          clearable
          placeholder="状态码"
        >
          <el-option label="全部" value="" />
          <el-option label="成功 (2xx/3xx)" value="success" />
          <el-option label="客户端错误 (4xx)" value="4xx" />
          <el-option label="服务器错误 (5xx)" value="5xx" />
        </el-select>
        <el-input
          v-model="filterPathKeyword"
          placeholder="路径关键词"
          clearable
          class="filter-item"
          @keyup.enter="handleSearch"
        />
        <el-input
          v-model="filterUserId"
          type="number"
          placeholder="用户ID"
          clearable
          class="filter-item filter-item--narrow"
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
      <el-table v-loading="isLoading" :data="list" stripe row-key="id">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="method" label="Method" width="90">
          <template #default="{ row }">
            <el-tag :type="methodTagType(row.method)" size="small">{{ row.method }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="path" label="Path" min-width="200" show-overflow-tooltip />
        <el-table-column prop="routePattern" label="RoutePattern" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.routePattern || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="statusCode" label="StatusCode" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.statusCode)" size="small">{{ row.statusCode }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="Duration" width="100" align="center">
          <template #default="{ row }">{{ row.durationMs }}ms</template>
        </el-table-column>
        <el-table-column prop="userId" label="UserId" width="90" align="center">
          <template #default="{ row }">{{ row.userId ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="130">
          <template #default="{ row }">{{ row.ip || '-' }}</template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showDetail(row as ApiCallLogItem)">查看详情</el-button>
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
    <el-drawer v-model="detailVisible" direction="rtl" size="40%" title="API 调用日志详情">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="Method">
          <el-tag :type="methodTagType(detailRow.method)" size="small">{{ detailRow.method }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="Path">{{ detailRow.path }}</el-descriptions-item>
        <el-descriptions-item label="RoutePattern">{{ detailRow.routePattern || '-' }}</el-descriptions-item>
        <el-descriptions-item label="StatusCode">
          <el-tag :type="statusTagType(detailRow.statusCode)" size="small">{{ detailRow.statusCode }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="DurationMs">{{ detailRow.durationMs }}ms</el-descriptions-item>
        <el-descriptions-item label="UserId">{{ detailRow.userId ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="IP">{{ detailRow.ip || '-' }}</el-descriptions-item>
        <el-descriptions-item label="CreatedAt">{{ formatDate(detailRow.createdAt) }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.api-call-log-page {
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

.filter-item--narrow {
  width: 120px;
}

.filter-item--date {
  width: 160px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
