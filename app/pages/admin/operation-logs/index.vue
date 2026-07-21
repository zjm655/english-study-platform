<template>
  <div class="operation-log-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">操作日志</h2>
        <p class="page-desc">
          查看所有管理员操作记录，支持按操作类型筛选和关键词搜索
        </p>
      </div>
    </div>

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
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card class="table-card" shadow="never">
      <el-table v-loading="isLoading" :data="list" stripe row-key="id">
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
        <el-table-column label="详情" min-width="180">
          <template #default="{ row }">
            <template v-if="row.detail">
              <el-popover placement="left" :width="320" trigger="click">
                <template #reference>
                  <el-button link type="primary" size="small">查看详情</el-button>
                </template>
                <pre class="json-detail">{{ JSON.stringify(row.detail, null, 2) }}</pre>
              </el-popover>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
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
  </div>
</template>

<script setup lang="ts">
import { useAdminOperationLogList } from '~/composables/admin'
import type { AdminOperationLogItem } from '#shared/types/adminOperationLog'

definePageMeta({
  layout: 'admin',
  title: '操作日志',
})

useSeoMeta({ title: '操作日志 - 管理后台' })

const { isLoading, execute } = useAdminOperationLogList()

const filterAction = ref('')
const filterKeyword = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminOperationLogItem[]>([])

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    action: filterAction.value || undefined,
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
  filterAction.value = ''
  filterKeyword.value = ''
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
  loadList()
})
</script>

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
}
</style>
