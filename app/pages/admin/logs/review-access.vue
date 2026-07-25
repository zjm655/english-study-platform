<script setup lang="ts">
import { useReviewAccessLogList } from '~/composables/admin'
import { adminLogsExportPath } from '~/api/paths'
import {
  REVIEW_TARGET_TYPES,
  REVIEW_TARGET_TYPE_LABELS,
  REVIEW_REASON_CATEGORIES,
} from '#shared/utils/permission'
import type { ReviewTargetType } from '#shared/utils/permission'
import type { ReviewAccessLogItem } from '#shared/types/adminLogs'

definePageMeta({ layout: 'admin', title: '审核留痕' })
useSeoMeta({ title: '审核留痕 - 管理后台' })

const { isLoading, execute } = useReviewAccessLogList()

// 筛选
const filterTargetType = ref('')
const filterReasonCategory = ref('')
const filterKeyword = ref('')
const filterStartDate = ref('')
const filterEndDate = ref('')

// 分页
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<ReviewAccessLogItem[]>([])

// 详情 Drawer
const detailVisible = ref(false)
const detailRow = ref<ReviewAccessLogItem | null>(null)

async function loadList() {
  const res = await execute({
    page: page.value,
    pageSize: pageSize.value,
    targetType: filterTargetType.value || undefined,
    reasonCategory: filterReasonCategory.value || undefined,
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
  page.value = 1
  loadList()
}

function handleReset() {
  filterTargetType.value = ''
  filterReasonCategory.value = ''
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

function showDetail(row: ReviewAccessLogItem) {
  detailRow.value = row
  detailVisible.value = true
}

function handleExport() {
  const params = new URLSearchParams()
  params.append('table', 'review_access_log')
  if (filterStartDate.value) params.append('startDate', filterStartDate.value)
  if (filterEndDate.value) params.append('endDate', filterEndDate.value)
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

function targetTypeLabel(type: string) {
  return REVIEW_TARGET_TYPE_LABELS[type as ReviewTargetType] ?? type
}

function targetTypeTag(type: string) {
  // 公开状态调整是写操作，用 warning 突出；其余为只读查看
  return type === 'segment_visibility' ? 'warning' : 'info'
}

function roleLabel(role: number) {
  return role === 2 ? '超管' : role === 1 ? '管理员' : '用户'
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
  <div class="review-access-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">审核留痕</h2>
        <p class="page-desc">
          持审核权限的管理员查看用户非公开材料/配音等敏感操作的留痕记录（审计数据只增不删）
        </p>
      </div>
    </div>

    <!-- 操作栏（审计数据不可清理，仅提供导出） -->
    <el-card class="action-card" shadow="never">
      <div class="action-bar">
        <el-button type="primary" @click="handleExport">导出 CSV（最近 5 万条）</el-button>
      </div>
    </el-card>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-select
          v-model="filterTargetType"
          class="filter-item"
          clearable
          placeholder="对象类型"
          @change="handleSearch"
        >
          <el-option label="全部" value="" />
          <el-option
            v-for="t in REVIEW_TARGET_TYPES"
            :key="t"
            :label="REVIEW_TARGET_TYPE_LABELS[t]"
            :value="t"
          />
        </el-select>
        <el-select
          v-model="filterReasonCategory"
          class="filter-item"
          clearable
          placeholder="理由类别"
          @change="handleSearch"
        >
          <el-option label="全部" value="" />
          <el-option v-for="c in REVIEW_REASON_CATEGORIES" :key="c" :label="c" :value="c" />
        </el-select>
        <el-input
          v-model="filterKeyword"
          placeholder="搜索操作者账号"
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
      <el-table v-loading="isLoading" :data="list" stripe row-key="id">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="operatorAccount" label="操作者" width="130">
          <template #default="{ row }">{{ row.operatorAccount || '已删除' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.operatorRole === 2 ? 'danger' : 'primary'" size="small">
              {{ roleLabel(row.operatorRole) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象类型" width="130" align="center">
          <template #default="{ row }">
            <el-tag :type="targetTypeTag(row.targetType)" size="small">
              {{ targetTypeLabel(row.targetType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="targetId" label="对象ID" width="80" align="center" />
        <el-table-column label="归属用户" width="130">
          <template #default="{ row }">{{ row.targetUserAccount || '-' }}</template>
        </el-table-column>
        <el-table-column prop="reasonCategory" label="理由类别" width="120" align="center" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              size="small"
              @click="showDetail(row as ReviewAccessLogItem)"
              >查看详情</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无留痕记录" :image-size="80" />
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
    <el-drawer v-model="detailVisible" direction="rtl" size="40%" title="审核留痕详情">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ detailRow.id }}</el-descriptions-item>
        <el-descriptions-item label="操作者">
          {{ detailRow.operatorAccount || '已删除' }}（ID: {{ detailRow.operatorId ?? '-' }}）
        </el-descriptions-item>
        <el-descriptions-item label="角色快照">{{
          roleLabel(detailRow.operatorRole)
        }}</el-descriptions-item>
        <el-descriptions-item label="对象类型">
          <el-tag :type="targetTypeTag(detailRow.targetType)" size="small">
            {{ targetTypeLabel(detailRow.targetType) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="对象ID">{{ detailRow.targetId }}</el-descriptions-item>
        <el-descriptions-item label="归属用户">
          {{ detailRow.targetUserAccount || '-' }}（ID: {{ detailRow.targetUserId ?? '-' }}）
        </el-descriptions-item>
        <el-descriptions-item label="理由类别">{{ detailRow.reasonCategory }}</el-descriptions-item>
        <el-descriptions-item label="详细理由">
          <span class="reason-text">{{ detailRow.reason }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="IP">{{ detailRow.ip || '-' }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{
          formatDate(detailRow.createdAt)
        }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.review-access-page {
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
  width: 240px;
}

.filter-item--date {
  width: 160px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.reason-text {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
