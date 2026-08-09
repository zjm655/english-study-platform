<template>
  <div class="material-list-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">材料管理</h2>
        <p class="page-desc">查看、编辑与管理全部学习材料（软删除后对学生不可见）。</p>
      </div>
      <el-button type="primary" @click="goUpload">
        <el-icon><Upload /></el-icon>
        <span>上传材料</span>
      </el-button>
    </div>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-select
          v-model="filterUnitId"
          placeholder="全部单元"
          clearable
          filterable
          class="filter-item"
        >
          <el-option v-for="u in units" :key="u.id" :label="u.title" :value="u.id" />
        </el-select>

        <el-select
          v-model="filterIsPublic"
          placeholder="全部状态"
          clearable
          class="filter-item filter-item--narrow"
        >
          <el-option label="公开" :value="1" />
          <el-option label="私有" :value="0" />
        </el-select>

        <el-input
          v-model="filterKeyword"
          placeholder="按标题搜索"
          clearable
          class="filter-item filter-item--search"
          :prefix-icon="Search"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
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
        :row-label="(r) => r.title"
        @clear="clear"
        @remove="removeRow"
      >
        <el-button type="primary" size="small" @click="openMoveDialog">批量修改单元</el-button>
        <el-button type="danger" size="small" @click="handleBatchDelete">批量删除</el-button>
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
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
        <el-table-column prop="unitTitle" label="所属单元" min-width="150" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isPublic === 1 ? 'success' : 'info'" size="small">
              {{ row.isPublic === 1 ? '公开' : '私有' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="NLS 校验" width="100" align="center">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.nlsCheck === 1"
              content="该材料上传时开启了 NLS 语音校对（识别+相似度核验）"
              placement="top"
            >
              <el-tag type="warning" size="small">已启用</el-tag>
            </el-tooltip>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }: any">
            <el-button type="primary" link size="small" @click="goEdit(row)">编辑</el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无材料" :image-size="80" />
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

    <!-- 批量修改所属单元弹窗 -->
    <el-dialog v-model="moveVisible" title="批量修改所属单元" width="420px">
      <el-form label-width="80px">
        <el-form-item label="选中材料">
          <span>{{ selectedRows.length }} 条</span>
        </el-form-item>
        <el-form-item label="目标单元">
          <el-select v-model="moveUnitId" placeholder="选择单元" filterable style="width: 260px">
            <el-option v-for="u in units" :key="u.id" :label="u.title" :value="u.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="moveVisible = false">取消</el-button>
        <el-button type="primary" :loading="isBatching" @click="handleBatchMove"
          >确认修改</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Upload, Search } from '@element-plus/icons-vue'
import {
  useAdminSegmentList,
  useDeleteAdminSegment,
  useBatchAdminSegments,
  useTableSelection,
} from '~/composables/admin'
import { useUnits } from '~/composables/unit'
import type { AdminSegmentListItem, AdminSegmentListQuery } from '#shared/types/adminSegment'
import type { UnitWithProgress } from '#shared/types/unit'

definePageMeta({
  layout: 'admin',
  title: '材料管理',
})

useSeoMeta({ title: '材料管理 - 管理后台' })

// 筛选条件
const filterUnitId = ref<number>()
const filterIsPublic = ref<0 | 1>()
const filterKeyword = ref('')

// 分页
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminSegmentListItem[]>([])

// 单元下拉数据
const units = ref<UnitWithProgress[]>([])

const { isLoading, execute: listExecute } = useAdminSegmentList()
const { execute: deleteExecute } = useDeleteAdminSegment()
const { isLoading: isBatching, execute: batchExecute } = useBatchAdminSegments()
const { execute: executeUnits } = useUnits()

// 批量选择（reserve-selection 跨页保留；上限对齐后端 batchIds=100）
const {
  tableRef,
  selectedRows,
  selectedIds,
  onSelectionChange,
  clear,
  canSelect,
  removeRow,
  offPageCount,
} = useTableSelection<AdminSegmentListItem>({ limit: 100, pageRows: () => list.value })

// 批量修改单元弹窗
const moveVisible = ref(false)
const moveUnitId = ref<number>()

function buildQuery(): AdminSegmentListQuery {
  return {
    page: page.value,
    pageSize: pageSize.value,
    // unitId/isPublic 可能为 0，须用 typeof 判断而非真值判断
    unitId: typeof filterUnitId.value === 'number' ? filterUnitId.value : undefined,
    isPublic: typeof filterIsPublic.value === 'number' ? filterIsPublic.value : undefined,
    keyword: filterKeyword.value.trim() || undefined,
  }
}

async function loadList() {
  const res = await listExecute(buildQuery())
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
  filterUnitId.value = undefined
  filterIsPublic.value = undefined
  filterKeyword.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

function goUpload() {
  navigateTo('/admin/material/upload')
}

function goEdit(row: AdminSegmentListItem) {
  navigateTo(`/admin/material/${row.id}`)
}

async function handleDelete(row: AdminSegmentListItem) {
  try {
    await toastConfirm(`确定删除材料「${row.title}」吗？删除后将对学生不可见。`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }
  const res = await deleteExecute(row.id)
  if (res?.code === 200) {
    toastSuccess('删除成功')
    // 当前页删空且非首页时回退一页
    if (list.value.length === 1 && page.value > 1) page.value -= 1
    loadList()
  }
}

async function handleBatchDelete() {
  const count = selectedRows.value.length
  // 页内选中数（跨页选中后 count 可能大于当前页行数，回退页码须按页内数判断）
  const onPageCount = count - offPageCount.value
  try {
    await toastConfirm(`确定删除选中的 ${count} 条材料吗？删除后将对学生不可见。`, '批量删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }
  const res = await batchExecute({ action: 'delete', ids: selectedIds.value })
  if (res?.code === 200 && res.data) {
    toastBatchResult(res.data)
    clear()
    // 当前页可能被删空且非首页时回退一页
    if (list.value.length === onPageCount && page.value > 1) page.value -= 1
    loadList()
  }
}

function openMoveDialog() {
  moveUnitId.value = undefined
  moveVisible.value = true
}

async function handleBatchMove() {
  if (typeof moveUnitId.value !== 'number') {
    toastWarning('请选择目标单元')
    return
  }
  const res = await batchExecute({
    action: 'move',
    ids: selectedIds.value,
    unitId: moveUnitId.value,
  })
  if (res?.code === 200 && res.data) {
    toastBatchResult(res.data)
    moveVisible.value = false
    clear()
    loadList()
  }
}

function formatDate(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function loadUnits() {
  const res = await executeUnits(undefined)
  if (res?.code === 200 && res.data) {
    units.value = res.data
  }
}

onMounted(() => {
  // 跨页导航预填：单元列表「查看材料」携带 ?unitId= 跳入，复用单元筛选模型
  // （仿 logs/api-call 读 ?path= 的既有模式；unitId=0 自定义单元合法，不可真值判断）
  const route = useRoute()
  const queryUnitId = Number(route.query.unitId)
  if (route.query.unitId !== undefined && Number.isInteger(queryUnitId) && queryUnitId >= 0) {
    filterUnitId.value = queryUnitId
  }
  loadUnits()
  loadList()
})
</script>

<style scoped>
.material-list-page {
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
  width: 220px;
}

.filter-item--narrow {
  width: 140px;
}

.filter-item--search {
  width: 260px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
