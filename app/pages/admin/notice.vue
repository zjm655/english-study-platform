<template>
  <div class="notice-admin-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">公告管理</h2>
        <p class="page-desc">
          系统公告的创建、发布、撤回与阅读统计（定时发布 = 已发布 +
          未来上线时间，列表显示「待上线」； 已发布公告仅可修改过期时间与置顶，或撤回下线）。
        </p>
      </div>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>
        <span>新建公告</span>
      </el-button>
    </div>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-select v-model="filterStatus" class="filter-item filter-item--narrow">
          <el-option label="全部" value="all" />
          <el-option label="草稿" value="draft" />
          <el-option label="已发布" value="published" />
          <el-option label="已撤回" value="revoked" />
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
      <el-table v-loading="isLoading" :data="list" stripe row-key="id">
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="displayStatus(row as AdminNoticeListItem).type" size="small">{{
              displayStatus(row as AdminNoticeListItem).label
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="置顶" width="70" align="center">
          <template #default="{ row }">{{ row.isPinned ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column prop="readCount" label="已读人数" width="90" align="center" />
        <el-table-column label="上线时间" width="170">
          <template #default="{ row }">{{ formatDate(row.publishAt) }}</template>
        </el-table-column>
        <el-table-column label="过期时间" width="170">
          <template #default="{ row }">{{ formatDate(row.expireAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              size="small"
              :disabled="row.status === 'revoked'"
              @click="openEdit(row as AdminNoticeListItem)"
            >
              编辑
            </el-button>
            <el-button
              v-if="row.status === 'published'"
              type="warning"
              link
              size="small"
              @click="handleRevoke(row as AdminNoticeListItem)"
            >
              撤回
            </el-button>
            <el-button
              type="danger"
              link
              size="small"
              @click="handleDelete(row as AdminNoticeListItem)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无公告" :image-size="80" />
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

    <!-- 新建 / 编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="560px"
      destroy-on-close
      @closed="resetForm"
    >
      <!-- 已发布公告仅放开过期时间与置顶，其余字段禁用 -->
      <el-alert
        v-if="isPublishedEdit"
        type="info"
        :closable="false"
        show-icon
        class="dialog-alert"
        title="已发布公告仅可修改过期时间与置顶，其余字段不可编辑"
      />
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="82px">
        <el-form-item label="标题" prop="title">
          <el-input
            v-model="form.title"
            maxlength="200"
            show-word-limit
            placeholder="公告标题"
            :disabled="isPublishedEdit"
          />
        </el-form-item>
        <el-form-item label="正文" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="6"
            maxlength="5000"
            show-word-limit
            placeholder="公告正文（展示时保留换行）"
            :disabled="isPublishedEdit"
          />
        </el-form-item>
        <el-form-item label="上线时间" prop="publishAt">
          <el-date-picker
            v-model="form.publishAt"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="留空 = 发布时立即上线"
            :disabled="isPublishedEdit"
            clearable
          />
        </el-form-item>
        <el-form-item label="过期时间" prop="expireAt">
          <el-date-picker
            v-model="form.expireAt"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="留空 = 永不过期"
            clearable
          />
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="form.isPinned" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <!-- 已发布：仅保存放开的两个字段 -->
        <el-button
          v-if="isPublishedEdit"
          type="primary"
          :loading="isSaving"
          @click="handleSavePublished"
        >
          保存
        </el-button>
        <!-- 新建 / 草稿编辑：存草稿 或 （立即/定时）发布 -->
        <template v-else>
          <el-button :loading="isSaving" @click="handleSave('draft')">存草稿</el-button>
          <el-button type="primary" :loading="isSaving" @click="handleSave('published')">
            {{ publishLabel }}
          </el-button>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Plus, Search } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import {
  useAdminNoticeList,
  useCreateAdminNotice,
  useUpdateAdminNotice,
  useDeleteAdminNotice,
} from '~/composables/notice'
import type { AdminNoticeListItem, NoticeStatus } from '#shared/types/notice'

definePageMeta({
  layout: 'admin',
  title: '公告管理',
})

useSeoMeta({ title: '公告管理 - 管理后台' })

// 筛选条件
const filterStatus = ref<NoticeStatus | 'all'>('all')
const filterKeyword = ref('')

// 分页
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminNoticeListItem[]>([])

const { isLoading, execute: listExecute } = useAdminNoticeList()
const { isLoading: isCreating, execute: createExecute } = useCreateAdminNotice()
const { isLoading: isUpdating, execute: updateExecute } = useUpdateAdminNotice()
const { execute: deleteExecute } = useDeleteAdminNotice()

const isSaving = computed(() => isCreating.value || isUpdating.value)

/** 展示态状态映射：published + 未来 publishAt 派生为「待上线」 */
function displayStatus(row: AdminNoticeListItem): {
  label: string
  type: 'info' | 'success' | 'warning' | 'danger'
} {
  if (row.status === 'draft') return { label: '草稿', type: 'info' }
  if (row.status === 'revoked') return { label: '已撤回', type: 'danger' }
  const publishTime = new Date(row.publishAt).getTime()
  if (!isNaN(publishTime) && publishTime > Date.now()) return { label: '待上线', type: 'warning' }
  return { label: '已发布', type: 'success' }
}

async function loadList() {
  const res = await listExecute({
    page: page.value,
    pageSize: pageSize.value,
    status: filterStatus.value === 'all' ? undefined : filterStatus.value,
    keyword: filterKeyword.value.trim() || undefined,
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
  filterStatus.value = 'all'
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
// 编辑中公告的原始状态（决定表单放开范围与底部按钮）
const editingStatus = ref<NoticeStatus>('draft')
const formRef = ref<FormInstance>()

const form = reactive({
  title: '',
  content: '',
  publishAt: null as string | null,
  expireAt: null as string | null,
  isPinned: false,
})

const formRules: FormRules = {
  title: [
    { required: true, message: '标题不能为空', trigger: 'blur' },
    { max: 200, message: '标题不能超过 200 个字符', trigger: 'blur' },
  ],
  content: [
    { required: true, message: '正文不能为空', trigger: 'blur' },
    { max: 5000, message: '正文不能超过 5000 个字符', trigger: 'blur' },
  ],
}

const isPublishedEdit = computed(
  () => dialogMode.value === 'edit' && editingStatus.value === 'published',
)

const dialogTitle = computed(() =>
  dialogMode.value === 'create' ? '新建公告' : `编辑公告（ID: ${editingId.value}）`,
)

// 发布按钮文案：填了未来上线时间即定时发布，否则立即发布
const publishLabel = computed(() => {
  if (!form.publishAt) return '立即发布'
  const t = new Date(form.publishAt).getTime()
  return !isNaN(t) && t > Date.now() ? '定时发布' : '立即发布'
})

function resetForm() {
  form.title = ''
  form.content = ''
  form.publishAt = null
  form.expireAt = null
  form.isPinned = false
  editingId.value = undefined
  editingStatus.value = 'draft'
}

function openCreate() {
  dialogMode.value = 'create'
  dialogVisible.value = true
}

function openEdit(row: AdminNoticeListItem) {
  dialogMode.value = 'edit'
  editingId.value = row.id
  editingStatus.value = row.status
  form.title = row.title
  form.content = row.content
  form.publishAt = row.publishAt ? toDatetimeString(row.publishAt) : null
  form.expireAt = row.expireAt ? toDatetimeString(row.expireAt) : null
  form.isPinned = row.isPinned
  dialogVisible.value = true
}

/** 后端时间串（ISO 等）归一化为 el-date-picker 的 value-format 形态 */
function toDatetimeString(s: string) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 新建 / 草稿编辑保存（status 决定存草稿还是发布） */
async function handleSave(status: Extract<NoticeStatus, 'draft' | 'published'>) {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  const payload = {
    title: form.title.trim(),
    content: form.content.trim(),
    publishAt: form.publishAt || null,
    expireAt: form.expireAt || null,
    isPinned: form.isPinned,
    status,
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

/** 已发布公告保存：仅提交放开的 expireAt / isPinned */
async function handleSavePublished() {
  const res = await updateExecute({
    id: editingId.value!,
    data: {
      expireAt: form.expireAt || null,
      isPinned: form.isPinned,
    },
  })
  if (res?.code === 200) {
    dialogVisible.value = false
    loadList()
  }
}

// ============== 撤回 / 删除 ==============

async function handleRevoke(row: AdminNoticeListItem) {
  try {
    await toastConfirm(
      `确定撤回公告「${row.title}」吗？撤回后用户端不再可见，且不可再编辑。`,
      '撤回确认',
      {
        confirmButtonText: '撤回',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return // 用户取消
  }
  const res = await updateExecute({ id: row.id, data: { status: 'revoked' } })
  if (res?.code === 200) {
    loadList()
  }
}

async function handleDelete(row: AdminNoticeListItem) {
  try {
    await toastConfirm(
      `确定删除公告「${row.title}」（ID: ${row.id}）吗？删除后不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return // 用户取消
  }
  const res = await deleteExecute(row.id)
  if (res?.code === 200) {
    // 当前页删空且非首页时回退一页
    if (list.value.length === 1 && page.value > 1) page.value -= 1
    loadList()
  }
}

function formatDate(s: string | null) {
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
.notice-admin-page {
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

.dialog-alert {
  margin-bottom: 16px;
}
</style>
