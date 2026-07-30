<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { useCleanLogs, useLogArchiveStats, usePurgeLogArchive } from '~/composables/admin'
import { adminLogsExportPath } from '~/api/paths'
import type { LogArchiveStatsItem } from '#shared/types/adminLogs'

/**
 * 日志归档操作条（三个日志子页共用）：
 * 归档清理（迁入归档表）+ 归档统计展示 + 归档 CSV 导出 + 超期归档彻底删除。
 * 父页面仅需传原表名/中文名与日期筛选，归档成功后通过 archived 事件刷新列表。
 */
const props = defineProps<{
  /** 原表名（api_call_log / cloud_service_call_log / admin_operation_log） */
  table: string
  /** 表中文名，用于确认框文案 */
  tableLabel: string
  /** 导出归档 CSV 时附带的日期筛选（复用页面筛选栏） */
  startDate?: string
  endDate?: string
}>()

const emit = defineEmits<{ archived: [] }>()

const { execute: cleanLogsExec } = useCleanLogs()
const { execute: statsExec } = useLogArchiveStats()
const { execute: purgeExec } = usePurgeLogArchive()

const cleanDays = ref(90)
const archiving = ref(false)
const purgeDays = ref(180)
const purging = ref(false)
const stats = ref<LogArchiveStatsItem | null>(null)

async function loadStats() {
  // 统计失败静默（stats 保持旧值/空），不打断日志页主流程
  const res = await statsExec(null, { silent: true })
  if (res?.code === 200 && res.data) {
    stats.value = res.data.items.find((i) => i.table === props.table) ?? null
  }
}

async function handleArchive() {
  try {
    await ElMessageBox.confirm(
      `确定要归档 ${cleanDays.value} 天前的「${props.tableLabel}」吗？数据将迁入归档表并从原表删除，之后可随时从归档导出。`,
      '归档确认',
      { type: 'warning', confirmButtonText: '确定归档', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  archiving.value = true
  try {
    const res = await cleanLogsExec({ table: props.table, days: cleanDays.value })
    if (res.code === 200) {
      ElMessage.success(res.message ?? `已归档 ${res.data?.archivedRows ?? 0} 条记录`)
      emit('archived')
      loadStats()
    } else {
      ElMessage.error(res.message ?? '归档失败')
    }
  } finally {
    archiving.value = false
  }
}

function handleExportArchive() {
  const params = new URLSearchParams()
  params.append('table', `${props.table}_archive`)
  if (props.startDate) params.append('startDate', props.startDate)
  if (props.endDate) params.append('endDate', props.endDate)
  window.open(`${adminLogsExportPath}?${params.toString()}`, '_blank')
}

async function handlePurge() {
  try {
    await ElMessageBox.confirm(
      `确定要彻底删除 ${purgeDays.value} 天前的「${props.tableLabel}」归档吗？归档数据将被物理删除，不可恢复！`,
      '彻底删除确认',
      { type: 'error', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  purging.value = true
  try {
    const res = await purgeExec({ table: props.table, days: purgeDays.value })
    if (res.code === 200) {
      ElMessage.success(res.message ?? `已彻底删除 ${res.data?.deletedRows ?? 0} 条归档`)
      loadStats()
    } else {
      ElMessage.error(res.message ?? '删除失败')
    }
  } finally {
    purging.value = false
  }
}

function shortDate(s: string | null) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

onMounted(loadStats)
</script>

<template>
  <div class="log-archive-bar">
    <div class="log-archive-bar__row">
      <span class="log-archive-bar__label">归档</span>
      <el-input-number v-model="cleanDays" :min="7" :max="365" :step="30" style="width: 120px" />
      <span class="log-archive-bar__label">天前的数据</span>
      <el-button type="warning" :loading="archiving" @click="handleArchive">归档清理</el-button>
    </div>
    <div class="log-archive-bar__row">
      <span class="log-archive-bar__stats">
        已归档 {{ stats?.rows ?? 0 }} 条<template v-if="stats?.oldest">
          （{{ shortDate(stats.oldest) }} ~ {{ shortDate(stats.newest) }}）</template
        >
      </span>
      <el-button :disabled="!stats || stats.rows === 0" @click="handleExportArchive">
        导出归档 CSV
      </el-button>
      <el-divider direction="vertical" />
      <span class="log-archive-bar__label">彻底删除</span>
      <el-input-number v-model="purgeDays" :min="30" :max="3650" :step="30" style="width: 130px" />
      <span class="log-archive-bar__label">天前的归档</span>
      <el-button
        type="danger"
        :loading="purging"
        :disabled="!stats || stats.rows === 0"
        @click="handlePurge"
      >
        执行删除
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.log-archive-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-archive-bar__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.log-archive-bar__label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.log-archive-bar__stats {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
