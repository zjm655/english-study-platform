<script setup lang="ts">
import { useApiCallLogList, useTableSelection } from '~/composables/admin'
import { adminLogsExportPath } from '~/api/paths'
import type { ApiCallLogItem, ApiCallLogListQuery } from '#shared/types/adminLogs'

definePageMeta({ layout: 'admin', title: 'API 调用日志' })
useSeoMeta({ title: 'API 调用日志 - 管理后台' })

const { isLoading, execute } = useApiCallLogList()

// 筛选（method/statusCodeGroup 由 schema 收窄为枚举，ref 类型对齐 query 字段）
const filterMethod = ref<NonNullable<ApiCallLogListQuery['method']> | ''>('')
const filterStatusCodeGroup = ref<NonNullable<ApiCallLogListQuery['statusCodeGroup']> | ''>('')
const filterBusinessCode = ref<number | undefined>(undefined)
const filterPathKeyword = ref('')
const filterUserId = ref<number | undefined>(undefined)
const filterStartDate = ref('')
const filterEndDate = ref('')

// 分页
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<ApiCallLogItem[]>([])

// 批量选择（reserve-selection 跨页保留；选中行导出上限对齐后端 export ids=200）
const { tableRef, selectedRows, selectedIds, onSelectionChange, clear, canSelect, removeRow, offPageCount } =
  useTableSelection<ApiCallLogItem>({ limit: 200, pageRows: () => list.value })

// 详情 Drawer
const detailVisible = ref(false)
const detailRow = ref<ApiCallLogItem | null>(null)

// 实时 / 归档 Tab（P2-B：归档明细只读浏览）
const activeTab = ref<'current' | 'archive'>('current')

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    method: filterMethod.value || undefined,
    statusCodeGroup: filterStatusCodeGroup.value || undefined,
    businessCode: filterBusinessCode.value || undefined,
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
  clear() // 筛选变更清空选择：被筛掉的选中行不可见，保留即幽灵选中
  page.value = 1
  loadList()
}

function handleReset() {
  clear()
  filterMethod.value = ''
  filterStatusCodeGroup.value = ''
  filterBusinessCode.value = undefined
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

function handleExportSelected() {
  const params = new URLSearchParams()
  params.append('table', 'api_call_log')
  params.append('ids', selectedIds.value.join(','))
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
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
  // 跨页导航预填：运营统计错误路径分布点击跳转携带 ?path=，复用路径关键词筛选模型
  const route = useRoute()
  const queryPath = route.query.path
  if (typeof queryPath === 'string' && queryPath) {
    filterPathKeyword.value = queryPath
  }
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
        <AdminLogArchiveBar
          table="api_call_log"
          table-label="API 调用日志"
          :start-date="filterStartDate"
          :end-date="filterEndDate"
          @archived="loadList"
        />
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
          <el-option label="成功 (2xx/3xx + 业务码<400)" value="success" />
          <el-option label="客户端错误 (4xx/业务4xx)" value="4xx" />
          <el-option label="服务器错误 (5xx/业务5xx)" value="5xx" />
        </el-select>
        <el-input
          v-model="filterBusinessCode"
          type="number"
          placeholder="业务码（如 429/403/503）"
          clearable
          class="filter-item filter-item--narrow"
          @keyup.enter="handleSearch"
        />
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
      <el-tabs v-model="activeTab">
        <el-tab-pane label="实时日志" name="current">
          <AdminBatchBar
            :count="selectedRows.length"
            :off-page-count="offPageCount"
            :rows="selectedRows"
            :row-label="(r) => r.path"
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
        <el-table-column label="业务码" width="80" align="center">
          <template #default="{ row }">
            <el-tag
              v-if="row.businessCode != null"
              :type="statusTagType(row.businessCode)"
              size="small"
            >
              {{ row.businessCode }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="Duration" width="100" align="center">
          <template #default="{ row }">{{ row.durationMs }}ms</template>
        </el-table-column>
        <el-table-column label="错误" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.errorMessage" type="danger" size="small">错误</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="userId" label="UserId" width="90" align="center">
          <template #default="{ row }">
            <AdminUserLink
              :user-id="row.userId"
              :label="row.userId != null ? String(row.userId) : '-'"
            />
          </template>
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
        </el-tab-pane>
        <el-tab-pane label="归档明细" name="archive">
          <AdminArchiveList table="api_call_log_archive" />
        </el-tab-pane>
      </el-tabs>
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
        <el-descriptions-item label="业务码">
          <el-tag
            v-if="detailRow.businessCode != null"
            :type="statusTagType(detailRow.businessCode)"
            size="small"
          >
            {{ detailRow.businessCode }}
          </el-tag>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="DurationMs">{{ detailRow.durationMs }}ms</el-descriptions-item>
        <el-descriptions-item label="UserId">
          <AdminUserLink
            :user-id="detailRow.userId"
            :label="detailRow.userId != null ? String(detailRow.userId) : '-'"
          />
        </el-descriptions-item>
        <el-descriptions-item label="IP">{{ detailRow.ip || '-' }}</el-descriptions-item>
        <el-descriptions-item label="RequestId">{{ detailRow.requestId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="错误信息">
          <pre v-if="detailRow.errorMessage" class="admin-pre-text">{{ detailRow.errorMessage }}</pre>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="错误堆栈">
          <pre v-if="detailRow.errorStack" class="admin-pre-text">{{ detailRow.errorStack }}</pre>
          <span v-else>-</span>
        </el-descriptions-item>
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
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
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
