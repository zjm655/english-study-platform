<template>
  <div class="unit-list-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">单元列表</h2>
        <p class="page-desc">
          管理学习单元（ID 是材料的关联键；难度为数字，数字越大难度越高，0 为系统保留的自定义单元；
          删除为软删除，单元下材料将对学生不可见）。
        </p>
      </div>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>
        <span>新建单元</span>
      </el-button>
    </div>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-input-number
          v-model="filterLevel"
          :min="0"
          :step="1"
          step-strictly
          placeholder="难度等级"
          class="filter-item filter-item--narrow"
        />

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
        <el-table-column
          type="selection"
          width="46"
          reserve-selection
          :selectable="(row: any) => row.id !== 0 && canSelect(row)"
        />
        <el-table-column label="ID" width="90">
          <template #default="{ row }">
            <span class="unit-id">{{ row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.title }}</span>
            <el-tag v-if="row.id === 0" type="warning" size="small" class="reserved-tag"
              >系统保留</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />
        <el-table-column prop="level" label="难度" width="80" align="center" />
        <el-table-column prop="sortOrder" label="排序" width="80" align="center" />
        <el-table-column prop="segmentCount" label="材料数" width="90" align="center">
          <template #default="{ row }">
            <!-- 数字即入口：跳材料列表并自动按本单元筛选（id=0 自定义单元同样可筛） -->
            <el-link type="primary" @click="goMaterials(row.id)">{{ row.segmentCount }}</el-link>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="center" fixed="right">
          <template #default="{ row }: any">
            <el-button type="primary" link size="small" @click="goMaterials(row.id)">
              查看材料
            </el-button>
            <el-button
              type="primary"
              link
              size="small"
              :disabled="row.id === 0"
              @click="openEdit(row)"
            >
              编辑
            </el-button>
            <el-button
              type="danger"
              link
              size="small"
              :disabled="row.id === 0"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无单元" :image-size="80" />
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

    <!-- 新建 / 编辑弹窗（unit 字段少，无需详情页） -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建单元' : `编辑单元（ID: ${editingId}）`"
      width="520px"
      destroy-on-close
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="70px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="100" show-word-limit placeholder="单元标题" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="单元简介（可选）"
          />
        </el-form-item>
        <el-form-item label="难度" prop="level">
          <div class="level-field">
            <el-input-number v-model="form.level" :min="1" :step="1" step-strictly />
            <span class="field-hint">数字越大难度越高；0 为系统保留，不可使用</span>
          </div>
        </el-form-item>
        <el-form-item label="排序" prop="sortOrder">
          <el-input-number v-model="form.sortOrder" :min="0" :step="1" step-strictly />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="isSaving" @click="handleSave">
          {{ dialogMode === 'create' ? '新建' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Plus, Search } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import {
  useAdminUnitList,
  useCreateAdminUnit,
  useUpdateAdminUnit,
  useDeleteAdminUnit,
  useBatchDeleteAdminUnits,
  useTableSelection,
} from '~/composables/admin'
import { toastSuccess, toastConfirm, toastBatchResult } from '~/utils/popup'
import type { AdminUnitListItem, AdminUnitListQuery } from '#shared/types/adminUnit'

definePageMeta({
  layout: 'admin',
  title: '单元列表',
})

useSeoMeta({ title: '单元列表 - 管理后台' })

// 筛选条件（level 为原始数字等级，不做文案映射，便于后续自由扩展等级；el-input-number 清空时为 null）
const filterLevel = ref<number | null>(null)
const filterKeyword = ref('')

// 分页
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminUnitListItem[]>([])

const { isLoading, execute: listExecute } = useAdminUnitList()
const { isLoading: isCreating, execute: createExecute } = useCreateAdminUnit()
const { isLoading: isUpdating, execute: updateExecute } = useUpdateAdminUnit()
const { execute: deleteExecute } = useDeleteAdminUnit()
const { execute: batchDeleteExecute } = useBatchDeleteAdminUnits()

// 批量选择（reserve-selection 跨页保留；id=0 系统保留单元经 :selectable 不可选，后端 skipped 双保险）
const {
  tableRef,
  selectedRows,
  selectedIds,
  onSelectionChange,
  clear,
  canSelect,
  removeRow,
  offPageCount,
} = useTableSelection<AdminUnitListItem>({ limit: 100, pageRows: () => list.value })

const isSaving = computed(() => isCreating.value || isUpdating.value)

function buildQuery(): AdminUnitListQuery {
  return {
    page: page.value,
    pageSize: pageSize.value,
    // level 可能为 0（自定义单元），须用 typeof 判断而非真值判断
    level: typeof filterLevel.value === 'number' ? filterLevel.value : undefined,
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
  filterLevel.value = null
  filterKeyword.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

// ============== 新建 / 编辑弹窗 ==============

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref<number>()
const formRef = ref<FormInstance>()

const form = reactive({
  title: '',
  description: '',
  level: 1,
  sortOrder: 0,
})

const formRules: FormRules = {
  title: [
    { required: true, message: '标题不能为空', trigger: 'blur' },
    { max: 100, message: '标题不能超过 100 个字符', trigger: 'blur' },
  ],
  description: [{ max: 500, message: '简介不能超过 500 个字符', trigger: 'blur' }],
  level: [{ required: true, message: '请选择难度', trigger: 'change' }],
}

function resetForm() {
  form.title = ''
  form.description = ''
  form.level = 1
  form.sortOrder = 0
  editingId.value = undefined
}

function openCreate() {
  dialogMode.value = 'create'
  dialogVisible.value = true
}

function openEdit(row: AdminUnitListItem) {
  dialogMode.value = 'edit'
  editingId.value = row.id
  form.title = row.title
  form.description = row.description ?? ''
  form.level = row.level
  form.sortOrder = row.sortOrder
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  const payload = {
    title: form.title.trim(),
    description: form.description.trim() || null,
    level: form.level,
    sortOrder: form.sortOrder,
  }

  const res =
    dialogMode.value === 'create'
      ? await createExecute(payload)
      : await updateExecute({ id: editingId.value!, data: payload })
  if (res?.code === 200) {
    dialogVisible.value = false
    loadList()
  }
}

// ============== 删除（软删除 + 二次确认） ==============

async function handleDelete(row: AdminUnitListItem) {
  const impact =
    row.segmentCount > 0
      ? `该单元下有 ${row.segmentCount} 篇材料，删除后将对学生不可见。`
      : '删除后该单元将对学生不可见。'
  try {
    await toastConfirm(`确定删除单元「${row.title}」（ID: ${row.id}）吗？${impact}`, '删除确认', {
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
  // 汇总选中单元的材料数总和，强提示影响面
  const totalSegments = selectedRows.value.reduce((sum, row) => sum + row.segmentCount, 0)
  const impact =
    totalSegments > 0
      ? `选中单元下共有 ${totalSegments} 篇材料，删除后将对学生不可见。`
      : '删除后这些单元将对学生不可见。'
  try {
    await toastConfirm(`确定删除选中的 ${count} 个单元吗？${impact}`, '批量删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }
  const res = await batchDeleteExecute(selectedIds.value)
  if (res?.code === 200 && res.data) {
    toastBatchResult(res.data)
    // 页内选中数（跨页选中后 count 可能大于当前页行数，回退页码须按页内数判断）
    const onPageCount = count - offPageCount.value
    clear()
    // 当前页可能被删空且非首页时回退一页
    if (list.value.length === onPageCount && page.value > 1) page.value -= 1
    loadList()
  }
}

/** 跳材料列表并自动按本单元筛选（接收端在 material/index onMounted 读 query 预填） */
function goMaterials(unitId: number) {
  navigateTo(`/admin/material?unitId=${unitId}`)
}

function formatDate(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
.unit-list-page {
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

.unit-id {
  font-weight: 600;
  color: var(--el-color-primary);
}

.reserved-tag {
  margin-left: 6px;
}

.level-field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field-hint {
  font-size: 12px;
  color: var(--text-3);
}
</style>
