<script setup lang="ts">
import { useOperationLogListV2, useCleanLogs, useTableSelection } from '~/composables/admin'
import { adminLogsExportPath } from '~/api/paths'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AdminOperationLogItem } from '#shared/types/adminOperationLog'

definePageMeta({ layout: 'admin', title: '操作日志' })
useSeoMeta({ title: '操作日志 - 管理后台' })

const { isLoading, execute } = useOperationLogListV2()
const { execute: cleanLogsExec } = useCleanLogs()

// 筛选
const filterAction = ref('')
const filterKeyword = ref('')
const filterStartDate = ref('')
const filterEndDate = ref('')

// 分页
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<AdminOperationLogItem[]>([])

// 批量选择（reserve-selection 跨页保留；选中行导出上限对齐后端 export ids=200）
const { tableRef, selectedRows, selectedIds, onSelectionChange, clear, canSelect, removeRow, offPageCount } =
  useTableSelection<AdminOperationLogItem>({ limit: 200, pageRows: () => list.value })

// 详情 Drawer
const detailVisible = ref(false)
const detailRow = ref<AdminOperationLogItem | null>(null)

// 清理
const cleaning = ref(false)
const cleanDays = ref(90)

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    action: filterAction.value || undefined,
    keyword: filterKeyword.value.trim() || undefined,
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
  filterAction.value = ''
  filterKeyword.value = ''
  filterStartDate.value = ''
  filterEndDate.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

function showDetail(row: AdminOperationLogItem) {
  detailRow.value = row
  detailVisible.value = true
}

function handleExport() {
  const params = new URLSearchParams()
  params.append('table', 'admin_operation_log')
  if (filterStartDate.value) params.append('startDate', filterStartDate.value)
  if (filterEndDate.value) params.append('endDate', filterEndDate.value)
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

function handleExportSelected() {
  const params = new URLSearchParams()
  params.append('table', 'admin_operation_log')
  params.append('ids', selectedIds.value.join(','))
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

async function handleClean() {
  try {
    await ElMessageBox.confirm(
      `确定要清理 ${cleanDays.value} 天前的「管理员操作日志」吗？此操作不可恢复。`,
      '清理确认',
      { type: 'warning', confirmButtonText: '确定清理', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  cleaning.value = true
  try {
    const res = await cleanLogsExec({ table: 'admin_operation_log', days: cleanDays.value })
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

function actionTag(action: string) {
  if (action.includes('.ban') || action.includes('.delete')) return 'danger'
  if (action.includes('.unban') || action.includes('role')) return 'warning'
  return 'info'
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
  <div class="operation-log-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">操作日志</h2>
        <p class="page-desc">查看所有管理员操作记录，支持按操作类型筛选和关键词搜索</p>
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
          v-model="filterAction"
          class="filter-item"
          clearable
          placeholder="操作类型"
          @change="handleSearch"
        >
          <el-option label="全部" value="" />
          <el-option label="封禁用户" value="user.ban" />
          <el-option label="解封用户" value="user.unban" />
          <el-option label="销号" value="user.delete" />
          <el-option label="修改资料" value="user.update" />
          <el-option label="角色变更" value="user.role.update" />
          <el-option label="编辑材料" value="segment.update" />
          <el-option label="删除材料" value="segment.delete" />
        </el-select>
        <el-input
          v-model="filterKeyword"
          placeholder="搜索对象类型或ID"
          clearable
          class="filter-item filter-item--search"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
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
        :row-label="(r) => r.action"
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
        <el-table-column prop="adminAccount" label="管理员" width="130">
          <template #default="{ row }">{{ row.adminAccount || '已删除' }}</template>
        </el-table-column>
        <el-table-column prop="action" label="操作类型" width="150">
          <template #default="{ row }">
            <el-tag :type="actionTag(row.action)" size="small">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="targetType" label="对象类型" width="100" align="center" />
        <el-table-column prop="targetId" label="对象ID" width="80" align="center" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="showDetail(row as AdminOperationLogItem)">查看详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无操作记录" :image-size="80" />
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
    <el-drawer v-model="detailVisible" direction="rtl" size="40%" title="操作日志详情">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="管理员">{{ detailRow.adminAccount || '已删除' }}</el-descriptions-item>
        <el-descriptions-item label="操作类型">
          <el-tag :type="actionTag(detailRow.action)" size="small">{{ detailRow.action }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="对象类型">{{ detailRow.targetType }}</el-descriptions-item>
        <el-descriptions-item label="对象ID">{{ detailRow.targetId }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{ formatDate(detailRow.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="详情">
          <pre v-if="detailRow.detail" class="json-detail">{{ JSON.stringify(detailRow.detail, null, 2) }}</pre>
          <span v-else>-</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.operation-log-page {
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

.filter-item--search {
  width: 280px;
}

.filter-item--date {
  width: 160px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.json-detail {
  font-size: 12px;
  color: var(--text-2);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow: auto;
}
</style>
