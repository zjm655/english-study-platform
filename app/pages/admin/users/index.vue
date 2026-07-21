<template>
  <div class="user-list-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">用户管理</h2>
        <p class="page-desc">
          查询用户、修改资料、封禁/解封与销号（软删除）。管理员与已注销账号受操作保护。
        </p>
      </div>
    </div>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-input
          v-model="filterKeyword"
          placeholder="按账号 / 昵称搜索"
          clearable
          class="filter-item filter-item--search"
          :prefix-icon="Search"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="filterState"
          class="filter-item filter-item--narrow"
          @change="handleSearch"
        >
          <el-option label="全部" value="all" />
          <el-option label="正常" value="normal" />
          <el-option label="封禁" value="banned" />
          <el-option label="已注销" value="deleted" />
        </el-select>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card class="table-card" shadow="never">
      <el-table v-loading="isLoading" :data="list" stripe row-key="id">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="account" label="账号" min-width="120" />
        <el-table-column label="昵称" min-width="120">
          <template #default="{ row }">{{ row.nickname || '-' }}</template>
        </el-table-column>
        <el-table-column label="邮箱" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.email || '-' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.role === 1 ? 'warning' : 'info'" size="small">
              {{ row.role === 1 ? '管理员' : '用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="90" align="center">
          <template #default="{ row }">{{ levelText(row.level) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }: any">
            <el-tag :type="stateTag(row).type" size="small">{{ stateTag(row).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" align="center" fixed="right">
          <template #default="{ row }: any">
            <el-button
              type="primary"
              link
              size="small"
              @click="goDetail(row)"
              >详情</el-button
            >
            <el-button
              type="primary"
              link
              size="small"
              :disabled="row.deletedAt !== null"
              @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button
              :type="row.status === 1 ? 'warning' : 'success'"
              link
              size="small"
              :disabled="isLocked(row)"
              @click="handleToggleBan(row)"
            >
              {{ row.status === 1 ? '封禁' : '解封' }}
            </el-button>
            <el-button
              type="danger"
              link
              size="small"
              :disabled="isLocked(row)"
              @click="handleDelete(row)"
              >销号</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无用户" :image-size="80" />
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

    <!-- 编辑资料对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑用户资料"
      width="480px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="账号">
          <el-input :model-value="editForm.account" disabled />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input
            v-model="editForm.nickname"
            maxlength="50"
            show-word-limit
            placeholder="留空则清空昵称"
          />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="editForm.email" maxlength="255" placeholder="留空则清空邮箱" />
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="editForm.level" style="width: 200px">
            <el-option label="未测试" :value="0" />
            <el-option label="初级" :value="1" />
            <el-option label="中级" :value="2" />
            <el-option label="高级" :value="3" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="isSaving" @click="handleEditSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Search } from '@element-plus/icons-vue'
import {
  useAdminUserList,
  useUpdateAdminUser,
  useUpdateAdminUserStatus,
  useDeleteAdminUser,
} from '~/composables/admin'
import { toastSuccess, toastConfirm } from '~/utils/popup'
import type { AdminUserListItem, AdminUserState } from '#shared/types/adminUser'

definePageMeta({
  layout: 'admin',
  title: '用户管理',
})

useSeoMeta({ title: '用户管理 - 管理后台' })

// 筛选条件
const filterKeyword = ref('')
const filterState = ref<AdminUserState>('all')

// 分页
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminUserListItem[]>([])

const { isLoading, execute: listExecute } = useAdminUserList()
const { isLoading: isSaving, execute: updateExecute } = useUpdateAdminUser()
const { execute: statusExecute } = useUpdateAdminUserStatus()
const { execute: deleteExecute } = useDeleteAdminUser()

// 编辑对话框
const editDialogVisible = ref(false)
const editForm = reactive({ id: 0, account: '', nickname: '', email: '', level: 0 })

async function loadList() {
  const res = await listExecute({
    page: page.value,
    pageSize: pageSize.value,
    keyword: filterKeyword.value.trim() || undefined,
    state: filterState.value,
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
  filterKeyword.value = ''
  filterState.value = 'all'
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

// 管理员或已注销账号不可封禁/销号
function isLocked(row: AdminUserListItem) {
  return row.role === 1 || row.deletedAt !== null
}

function stateTag(row: AdminUserListItem) {
  if (row.deletedAt !== null) return { type: 'info' as const, text: '已注销' }
  return row.status === 1
    ? { type: 'success' as const, text: '正常' }
    : { type: 'danger' as const, text: '封禁' }
}

function levelText(level: number) {
  return ['未测试', '初级', '中级', '高级'][level] ?? '未测试'
}

function goDetail(row: AdminUserListItem) {
  navigateTo(`/admin/users/${row.id}`)
}

// ===== 编辑资料 =====
function openEdit(row: AdminUserListItem) {
  editForm.id = row.id
  editForm.account = row.account
  editForm.nickname = row.nickname ?? ''
  editForm.email = row.email ?? ''
  editForm.level = row.level
  editDialogVisible.value = true
}

async function handleEditSave() {
  const res = await updateExecute({
    id: editForm.id,
    data: {
      nickname: editForm.nickname.trim() || null,
      email: editForm.email.trim() || null,
      level: editForm.level,
    },
  })
  if (res?.code === 200) {
    toastSuccess('修改成功')
    editDialogVisible.value = false
    loadList()
  }
}

// ===== 封禁 / 解封 =====
async function handleToggleBan(row: AdminUserListItem) {
  const newStatus = row.status === 1 ? 0 : 1
  const actionText = newStatus === 0 ? '封禁' : '解封'
  try {
    await toastConfirm(
      `确定${actionText}用户「${row.nickname || row.account}」吗？${newStatus === 0 ? '封禁后该用户将立即无法访问平台。' : ''}`,
      `${actionText}确认`,
      { confirmButtonText: actionText, cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }
  const res = await statusExecute({ id: row.id, status: newStatus })
  if (res?.code === 200) {
    toastSuccess(`${actionText}成功`)
    loadList()
  }
}

// ===== 销号 =====
async function handleDelete(row: AdminUserListItem) {
  try {
    await toastConfirm(
      `确定销号用户「${row.nickname || row.account}」吗？销号后该用户将无法登录，数据保留但对其不可见。`,
      '销号确认',
      { confirmButtonText: '销号', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return // 用户取消
  }
  const res = await deleteExecute(row.id)
  if (res?.code === 200) {
    toastSuccess('销号成功')
    if (list.value.length === 1 && page.value > 1) page.value -= 1
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

onMounted(() => {
  loadList()
})
</script>

<style scoped>
.user-list-page {
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
  width: 280px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
