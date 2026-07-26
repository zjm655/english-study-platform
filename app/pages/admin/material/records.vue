<template>
  <div class="record-list-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">上传记录管理</h2>
        <p class="page-desc">
          查看所有用户上传和管理员上传的材料处理记录，支持按状态、来源、时间范围筛选。
        </p>
      </div>
    </div>

    <!-- 筛选栏 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-select
          v-model="filterStatus"
          class="filter-item filter-item--narrow"
          clearable
          placeholder="状态"
          @change="handleSearch"
        >
          <el-option label="全部" value="" />
          <el-option label="排队中" value="queued" />
          <el-option label="处理中" value="processing" />
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failed" />
        </el-select>
        <el-select
          v-model="filterSource"
          class="filter-item filter-item--narrow"
          @change="handleSearch"
        >
          <el-option label="全部来源" value="all" />
          <el-option label="用户上传" value="user" />
          <el-option label="管理员上传" value="admin" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          class="filter-item filter-item--date"
          :shortcuts="dateShortcuts"
        />
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card class="table-card" shadow="never">
      <el-table v-loading="isLoading" :data="list" stripe row-key="id">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusTagText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="失败原因" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error_message" class="error-msg">{{ row.error_message }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="上传者" width="120" />
        <el-table-column label="来源" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="sourceTagType(row.source)" size="small">
              {{ sourceTagText(row.source) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="公开" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_public ? 'success' : 'info'" size="small">
              {{ row.is_public ? '公开' : '私有' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }: any">
            <el-button type="primary" link size="small" @click="openDetail(row.id)">详情</el-button>
            <el-button
              v-if="row.status === 'failed'"
              type="warning"
              link
              size="small"
              @click="openReprocess(row)"
            >
              重处理
            </el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无上传记录" :image-size="80" />
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
          @current-change="() => loadList()"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog
      v-model="detailVisible"
      title="上传记录详情"
      width="640px"
      :close-on-click-modal="false"
    >
      <div v-if="detail" class="detail-body">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="ID">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="标题">{{ detail.title }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(detail.status)" size="small">
              {{ statusTagText(detail.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="来源">
            <el-tag :type="sourceTagType(detail.source)" size="small">
              {{ sourceTagText(detail.source) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="上传者">{{ detail.username }}</el-descriptions-item>
          <el-descriptions-item label="音色">{{ detail.voice }}</el-descriptions-item>
          <el-descriptions-item label="公开">
            <el-tag :type="detail.is_public ? 'success' : 'info'" size="small">
              {{ detail.is_public ? '公开' : '私有' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="片段ID">
            {{ detail.segment_id ?? '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{
            formatDate(detail.createdAt)
          }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{
            formatDate(detail.updatedAt)
          }}</el-descriptions-item>
          <el-descriptions-item
            v-if="detail.status === 'failed' && detail.error_message"
            label="失败原因"
            :span="2"
          >
            <span class="error-msg">{{ detail.error_message }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <div class="detail-section">
          <div class="detail-section__title">材料原文</div>
          <el-input
            :model-value="detail.text_content"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 12 }"
            readonly
          />
        </div>
        <div v-if="detail.status === 'success'" class="detail-section">
          <div class="detail-section__title">音频试听</div>
          <AudioPlayer
            v-if="detail.audioUrl"
            :src="detail.audioUrl"
            :duration="detail.duration ?? undefined"
          />
          <template v-else>
            <!-- 非公开用户材料被门禁扣留：有审核权限者可填理由解锁试听 -->
            <div v-if="can(PERMISSIONS.REVIEW)" class="audition-locked">
              <el-alert
                type="warning"
                :closable="false"
                show-icon
                title="非公开用户材料——需填写理由后试听"
                description="查看非公开用户材料将记录访问者、时间与理由用于隐私审计，请勿滥用。"
              />
              <el-button
                type="primary"
                plain
                class="audition-locked__btn"
                @click="auditionVisible = true"
              >
                <el-icon><Unlock /></el-icon><span>填理由解锁试听</span>
              </el-button>
            </div>
            <el-alert
              v-else
              type="info"
              :closable="false"
              show-icon
              title="非公开用户材料暂不支持试听"
              description="仅管理员上传或公开材料可试听；查看非公开用户材料需审核权限。"
            />
          </template>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 重处理弹窗 -->
    <el-dialog
      v-model="reprocessVisible"
      title="重处理失败记录"
      width="400px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="记录ID">
          <el-input :model-value="reprocessRecord?.id" disabled />
        </el-form-item>
        <el-form-item label="标题">
          <el-input :model-value="reprocessRecord?.title" disabled />
        </el-form-item>
        <el-form-item label="目标单元">
          <el-input-number
            v-model="reprocessUnitId"
            :min="0"
            :step="1"
            style="width: 200px"
            placeholder="0=自定义单元"
          />
          <span class="form-tip">0=自定义单元，正整数=指定单元</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reprocessVisible = false">取消</el-button>
        <el-button type="primary" :loading="isReprocessing" @click="handleReprocess">
          确认重处理
        </el-button>
      </template>
    </el-dialog>

    <!-- 审核门禁：填理由试听弹窗（records 与 material 编辑页复用同一组件） -->
    <AuditionReasonDialog
      v-model="auditionVisible"
      :loading="isAuditioning"
      @confirm="handleAudition"
    />
  </div>
</template>

<script setup lang="ts">
import { Unlock } from '@element-plus/icons-vue'
import {
  useAdminMaterialRecordList,
  useAdminMaterialRecordDetail,
  useDeleteAdminMaterialRecord,
  useReprocessAdminMaterialRecord,
  useAuditionMaterialRecord,
} from '~/composables/admin'
import { usePermission } from '~/composables/user'
import AuditionReasonDialog from '~/components/admin/AuditionReasonDialog.vue'
import { toastConfirm } from '~/utils/popup'
import { PERMISSIONS } from '#shared/utils/permission'
import type {
  AdminMaterialRecordListItem,
  AdminMaterialRecordDetail,
} from '#shared/types/adminMaterialRecord'

definePageMeta({
  layout: 'admin',
  title: '上传记录',
})

useSeoMeta({ title: '上传记录 - 管理后台' })

// 筛选条件
const filterStatus = ref('')
const filterSource = ref<'all' | 'user' | 'admin'>('all')
const dateRange = ref<[string, string] | null>(null)

const dateShortcuts = [
  {
    text: '今天',
    value: () => {
      const d = new Date()
      const s = fmt(d)
      return [s, s] as [string, string]
    },
  },
  {
    text: '最近7天',
    value: () => {
      const e = new Date()
      const s = new Date()
      s.setDate(s.getDate() - 7)
      return [fmt(s), fmt(e)] as [string, string]
    },
  },
  {
    text: '最近30天',
    value: () => {
      const e = new Date()
      const s = new Date()
      s.setDate(s.getDate() - 30)
      return [fmt(s), fmt(e)] as [string, string]
    },
  },
]

function fmt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 分页
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminMaterialRecordListItem[]>([])

const { can } = usePermission()

const { isLoading, execute: listExecute } = useAdminMaterialRecordList()
const { execute: detailExecute } = useAdminMaterialRecordDetail()
const { execute: deleteExecute } = useDeleteAdminMaterialRecord()
const { isLoading: isReprocessing, execute: reprocessExecute } = useReprocessAdminMaterialRecord()
const { isLoading: isAuditioning, execute: auditionExecute } = useAuditionMaterialRecord()

async function loadList(silent = false) {
  const res = await listExecute(
    {
      page: page.value,
      pageSize: pageSize.value,
      status: (filterStatus.value || undefined) as
        AdminMaterialRecordListItem['status'] | undefined,
      source: filterSource.value,
      startDate: dateRange.value?.[0],
      endDate: dateRange.value?.[1],
    },
    { silent },
  )
  if (res?.code === 200 && res.data) {
    list.value = res.data.list
    total.value = res.data.total
  }
}

// ─── 异步任务轮询：列表含排队/处理中记录时每 5s 静默刷新，无活跃项自动停止 ───
let pollTimer: ReturnType<typeof setInterval> | null = null
const hasActiveRecord = computed(() =>
  list.value.some((r) => r.status === 'queued' || r.status === 'processing'),
)

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(hasActiveRecord, (active) => {
  if (active && !pollTimer) {
    pollTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      await loadList(true)
      if (!hasActiveRecord.value) stopPolling()
    }, 5000)
  } else if (!active) {
    stopPolling()
  }
})

onUnmounted(stopPolling)

function handleSearch() {
  page.value = 1
  loadList()
}

function handleReset() {
  filterStatus.value = ''
  filterSource.value = 'all'
  dateRange.value = null
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

// ===== 详情弹窗 =====
const detailVisible = ref(false)
const detail = ref<AdminMaterialRecordDetail | null>(null)

async function openDetail(id: number) {
  detailVisible.value = true
  detail.value = null
  const res = await detailExecute(id)
  if (res?.code === 200 && res.data) {
    detail.value = res.data
  }
}

// ===== 审核门禁试听（非公开用户材料需填理由 + 留痕落库成功后才返签名 URL） =====
const auditionVisible = ref(false)

async function handleAudition(payload: { reasonCategory: string; reason: string }) {
  if (!detail.value) return
  const res = await auditionExecute({ id: detail.value.id, payload })
  if (res?.code === 200 && res.data) {
    detail.value.audioUrl = res.data.audioUrl
    detail.value.duration = res.data.duration
    auditionVisible.value = false
  }
}

// ===== 删除 =====
async function handleDelete(row: AdminMaterialRecordListItem) {
  try {
    await toastConfirm(`确定删除记录「${row.title}」吗？将同时删除关联的学习材料。`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const res = await deleteExecute(row.id)
  if (res?.code === 200) {
    if (list.value.length === 1 && page.value > 1) page.value -= 1
    loadList()
  }
}

// ===== 重处理 =====
const reprocessVisible = ref(false)
const reprocessRecord = ref<AdminMaterialRecordListItem | null>(null)
const reprocessUnitId = ref(0)

function openReprocess(row: AdminMaterialRecordListItem) {
  reprocessRecord.value = row
  reprocessUnitId.value = 0
  reprocessVisible.value = true
}

async function handleReprocess() {
  if (!reprocessRecord.value) return
  const res = await reprocessExecute({
    id: reprocessRecord.value.id,
    payload: { unitId: reprocessUnitId.value },
  })
  if (res?.code === 200) {
    reprocessVisible.value = false
    loadList()
  }
}

// ===== 工具函数 =====
function statusTagType(status: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' {
  return (
    ({ queued: 'info', processing: 'warning', success: 'success', failed: 'danger' } as const)[
      status
    ] ?? 'info'
  )
}
function statusTagText(status: string) {
  return (
    { queued: '排队中', processing: '处理中', success: '成功', failed: '失败' }[status] ?? status
  )
}
function sourceTagType(source: string) {
  return source === 'admin' ? 'warning' : 'info'
}
function sourceTagText(source: string) {
  return source === 'admin' ? '管理员' : '用户'
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
.record-list-page {
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
  width: 160px;
}

.filter-item--narrow {
  width: 130px;
}

.filter-item--date {
  width: 260px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.error-msg {
  color: var(--el-color-danger);
  font-size: 13px;
}

.text-muted {
  color: var(--text-4);
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.audition-locked {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.form-tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-3);
}
</style>
