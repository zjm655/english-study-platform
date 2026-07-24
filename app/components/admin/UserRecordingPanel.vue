<!-- app/components/admin/UserRecordingPanel.vue：用户详情页——录音记录列表（筛选/分页）+ 审核门禁详情抽屉 -->
<template>
  <div class="recording-panel">
    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-select
        v-model="filterPhase"
        class="filter-item filter-item--narrow"
        placeholder="全部阶段"
        @change="handleSearch"
      >
        <el-option label="全部阶段" value="" />
        <el-option label="配音" value="3" />
        <el-option label="跟读" value="4" />
      </el-select>
      <el-select
        v-model="filterUnitId"
        class="filter-item"
        clearable
        placeholder="全部单元"
        @change="handleSearch"
      >
        <el-option
          v-for="u in unitOptions"
          :key="u.unitId"
          :label="u.unitTitle"
          :value="u.unitId"
        />
      </el-select>
      <el-select
        v-model="filterScoreBand"
        class="filter-item filter-item--narrow"
        @change="handleSearch"
      >
        <el-option label="全部分数" value="all" />
        <el-option label="优秀（≥80）" value="high" />
        <el-option label="良好（60-79）" value="mid" />
        <el-option label="待提高（<60）" value="low" />
      </el-select>
      <el-input
        v-model="filterKeyword"
        class="filter-item"
        clearable
        placeholder="按片段标题搜索"
        @keyup.enter="handleSearch"
        @clear="handleSearch"
      />
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

    <!-- 列表 -->
    <el-table v-loading="isLoading" :data="list" stripe row-key="id" size="small">
      <el-table-column type="index" width="50" label="#" />
      <el-table-column prop="segmentTitle" label="片段" min-width="150" show-overflow-tooltip />
      <el-table-column prop="unitTitle" label="单元" min-width="120" show-overflow-tooltip />
      <el-table-column label="阶段" width="80" align="center">
        <template #default="{ row }">{{ phaseText(row.phase) }}</template>
      </el-table-column>
      <el-table-column label="得分" width="80" align="center">
        <template #default="{ row }">{{ row.score != null ? row.score : '-' }}</template>
      </el-table-column>
      <el-table-column label="评测状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.analyzeStatus)" size="small" effect="plain">
            {{ statusText(row.analyzeStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时长" width="90" align="center">
        <template #default="{ row }">{{
          row.duration != null ? formatDuration(row.duration) : '-'
        }}</template>
      </el-table-column>
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column v-if="canReview" label="操作" width="80" align="center" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="openAudition(row.id)">
            详情
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无录音记录" :image-size="60" />
      </template>
    </el-table>

    <div class="pagination-row">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        size="small"
        @current-change="loadList"
        @size-change="handleSizeChange"
      />
    </div>

    <!-- 审核门禁：填理由弹窗（进入详情前留痕） -->
    <AuditionReasonDialog
      v-model="auditionVisible"
      :loading="isAuditioning"
      title="查看录音评测详情"
      confirm-text="确认并查看"
      description="查看用户的配音 / 影子跟读录音与评测详情，将记录访问者、时间与理由用于隐私审计，请勿滥用。"
      @confirm="handleAudition"
    />

    <!-- 评测详情抽屉 -->
    <el-drawer v-model="drawerVisible" title="录音评测详情" size="600px" :destroy-on-close="true">
      <div v-if="drawerDetail" class="drawer-body">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="片段">{{ drawerDetail.segmentTitle }}</el-descriptions-item>
          <el-descriptions-item label="阶段">
            {{ phaseText(drawerDetail.recording.phase) }}
          </el-descriptions-item>
          <el-descriptions-item label="时长">
            {{ formatDuration(drawerDetail.recording.duration) }}
          </el-descriptions-item>
          <el-descriptions-item label="时间">
            {{ formatDate(drawerDetail.recording.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="drawerDetail.recording.audioPath" class="drawer-section">
          <div class="drawer-section__title">录音回放</div>
          <AudioPlayer
            :src="drawerDetail.recording.audioPath"
            :duration="drawerDetail.recording.duration ?? undefined"
          />
        </div>

        <div class="drawer-section">
          <div class="drawer-section__title">评测结果</div>
          <EvaluationResultCard
            v-if="
              drawerDetail.recording.analyzeStatus === 'success' &&
              drawerDetail.recording.score != null
            "
            :recording="drawerDetail.recording"
          />
          <el-alert
            v-else
            type="info"
            :closable="false"
            show-icon
            title="评测未完成或失败，暂无评分"
          />
        </div>

        <div class="drawer-section">
          <div class="drawer-section__title">识别文本</div>
          <p class="drawer-text">{{ drawerDetail.recording.recognizedText || '—' }}</p>
        </div>

        <div class="drawer-section">
          <div class="drawer-section__title">材料原文</div>
          <p class="drawer-text">{{ drawerDetail.referenceText || '—' }}</p>
        </div>
      </div>
      <el-empty v-else description="暂无详情" :image-size="60" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { useAdminUserRecordingList, useAuditionUserRecording } from '~/composables/admin'
import { usePermission } from '~/composables/user'
import AuditionReasonDialog from '~/components/admin/AuditionReasonDialog.vue'
import { PERMISSIONS } from '#shared/utils/permission'
import type {
  AdminUserRecordingListItem,
  AdminUserUnitOption,
  AdminRecordingDetailResult,
} from '#shared/types/adminUser'

const props = defineProps<{ userId: number }>()

const { can } = usePermission()
const canReview = computed(() => can(PERMISSIONS.REVIEW))

// 筛选条件
const filterPhase = ref<string>('')
const filterUnitId = ref<number | undefined>(undefined)
const filterScoreBand = ref<'all' | 'high' | 'mid' | 'low'>('all')
const filterKeyword = ref('')
const dateRange = ref<[string, string] | null>(null)

const dateShortcuts = [
  {
    text: '今天',
    value: () => {
      const s = fmt(new Date())
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

// 分页与数据
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<AdminUserRecordingListItem[]>([])
const unitOptions = ref<AdminUserUnitOption[]>([])

const { isLoading, execute: listExecute } = useAdminUserRecordingList()
const { isLoading: isAuditioning, execute: auditionExecute } = useAuditionUserRecording()

async function loadList() {
  const res = await listExecute({
    id: props.userId,
    query: {
      page: page.value,
      pageSize: pageSize.value,
      phase: filterPhase.value ? (Number(filterPhase.value) as 3 | 4) : undefined,
      unitId: filterUnitId.value,
      keyword: filterKeyword.value.trim() || undefined,
      scoreBand: filterScoreBand.value,
      startDate: dateRange.value?.[0],
      endDate: dateRange.value?.[1],
    },
  })
  if (res?.code === 200 && res.data) {
    list.value = res.data.list
    total.value = res.data.total
    unitOptions.value = res.data.unitOptions
  }
}

function handleSearch() {
  page.value = 1
  loadList()
}

function handleReset() {
  filterPhase.value = ''
  filterUnitId.value = undefined
  filterScoreBand.value = 'all'
  filterKeyword.value = ''
  dateRange.value = null
  page.value = 1
  loadList()
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

// ===== 审核门禁详情 =====
const auditionVisible = ref(false)
const drawerVisible = ref(false)
const pendingRecordingId = ref<number | null>(null)
const drawerDetail = ref<AdminRecordingDetailResult | null>(null)

function openAudition(recordingId: number) {
  pendingRecordingId.value = recordingId
  auditionVisible.value = true
}

async function handleAudition(payload: { reasonCategory: string; reason: string }) {
  if (pendingRecordingId.value == null) return
  const res = await auditionExecute({
    id: props.userId,
    recordingId: pendingRecordingId.value,
    payload,
  })
  if (res?.code === 200 && res.data) {
    drawerDetail.value = res.data
    auditionVisible.value = false
    drawerVisible.value = true
  }
}

// ===== 工具函数 =====
function phaseText(phase: number) {
  return phase === 3 ? '配音' : phase === 4 ? '跟读' : String(phase)
}

function statusText(status: string) {
  return { pending: '待分析', success: '完成', failed: '失败' }[status] ?? status
}

function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  return ({ success: 'success', pending: 'warning', failed: 'danger' } as const)[status] ?? 'info'
}

function formatDate(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return '00:00'
  const totalSec = Math.round(seconds)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

onMounted(() => {
  loadList()
})
</script>

<style scoped>
.recording-panel {
  width: 100%;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.filter-item {
  width: 150px;
}

.filter-item--narrow {
  width: 120px;
}

.filter-item--date {
  width: 240px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.drawer-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.drawer-section__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.drawer-text {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.7;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
