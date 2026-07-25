<script setup lang="ts">
import { ArrowLeft, Delete } from '@element-plus/icons-vue'
import {
  useMaterialRecords,
  useUpdateMaterialRecord,
  useDeleteMaterialRecord,
} from '~/composables/material/useUploadRecords'
import type { MaterialUploadRecordListItem } from '#shared/types/material'
import { ElMessageBox } from 'element-plus'

definePageMeta({ title: '上传记录' })

useSeoMeta({
  title: '上传记录',
  description: '查看自定义材料的上传处理进度与结果，管理已生成的个人学习材料。',
})

const router = useRouter()

const { isLoading, execute: fetchRecords } = useMaterialRecords()
const { execute: doUpdate } = useUpdateMaterialRecord()
const { execute: doDelete } = useDeleteMaterialRecord()

const records = ref<MaterialUploadRecordListItem[]>([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)

async function loadRecords() {
  const offset = (page.value - 1) * pageSize.value
  const res = await fetchRecords({ limit: pageSize.value, offset })
  if (res?.code === 200 && res.data) {
    records.value = res.data
    // 简单估算 total：如果返回条数等于 pageSize，说明还有更多
    if (res.data.length < pageSize.value) {
      total.value = offset + res.data.length
    } else {
      total.value = offset + pageSize.value + 1
    }
  }
}

onMounted(() => {
  loadRecords()
})

function getStatusType(status: string) {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    default:
      return 'info'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'success':
      return '成功'
    case 'failed':
      return '失败'
    case 'processing':
      return '处理中'
    default:
      return status
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function handleTogglePublic(record: MaterialUploadRecordListItem) {
  const newVal = record.is_public === 1 ? 0 : 1
  const res = await doUpdate({ id: record.id, payload: { isPublic: newVal } })
  if (res?.code === 200) {
    record.is_public = newVal
  }
}

async function handleDelete(record: MaterialUploadRecordListItem) {
  try {
    await ElMessageBox.confirm('确定删除这条记录吗？关联的学习数据也会被清理。', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const res = await doDelete(record.id)
    if (res?.code === 200) {
      records.value = records.value.filter((r) => r.id !== record.id)
    }
  } catch {
    // 用户取消
  }
}
</script>

<template>
  <div class="records-page">
    <div class="records-page__header">
      <button class="back-btn" @click="router.push('/learn')">
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <h2 class="records-page__title">上传记录</h2>
    </div>

    <div v-if="isLoading && !records.length" class="records-loading">加载中...</div>

    <div v-else-if="!records.length" class="records-empty">
      暂无上传记录
      <NuxtLink to="/learn/upload" class="records-empty__link">去上传材料</NuxtLink>
    </div>

    <div v-else class="records-list">
      <div
        v-for="record in records"
        :key="record.id"
        class="record-item"
        :class="{
          'record-item--success': record.status === 'success',
          'record-item--failed': record.status === 'failed',
          'record-item--processing': record.status === 'processing',
        }"
      >
        <div class="record-item__header">
          <div class="record-item__title">{{ record.title }}</div>
          <el-tag :type="getStatusType(record.status)" size="small">
            {{ getStatusLabel(record.status) }}
          </el-tag>
        </div>

        <div class="record-item__meta">
          <span class="record-item__time">{{ formatTime(record.createdAt) }}</span>
          <span v-if="record.status === 'success'" class="record-item__public">
            <el-switch
              :model-value="record.is_public === 1"
              active-text="公开"
              inactive-text="私密"
              size="small"
              @change="handleTogglePublic(record)"
            />
          </span>
        </div>

        <div v-if="record.error_message" class="record-item__error">
          {{ record.error_message }}
        </div>

        <div class="record-item__actions">
          <NuxtLink
            v-if="record.segment_id"
            :to="`/learn/unit/0#segment-${record.segment_id}`"
            class="record-item__goto"
          >
            去学习
          </NuxtLink>
          <button class="record-item__delete" @click="handleDelete(record)">
            <el-icon><Delete /></el-icon>
            <span>删除</span>
          </button>
        </div>
      </div>

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        class="records-pagination"
        @change="loadRecords"
      />
    </div>
  </div>
</template>

<style scoped>
.records-page {
  padding: 12px;
  max-width: 640px;
  margin: 0 auto;
}

.records-page__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--card);
  border-radius: var(--r-lg);
  cursor: pointer;
  color: var(--text-2);
  transition: color 0.2s;
}

.back-btn:hover {
  color: var(--primary);
}

.records-page__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0;
}

.records-loading,
.records-empty {
  text-align: center;
  padding: 40px 20px;
  font-size: 14px;
  color: var(--text-3);
}

.records-empty__link {
  display: block;
  margin-top: 12px;
  color: var(--primary);
  text-decoration: none;
}

.records-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.record-item {
  background: var(--card);
  border-radius: var(--r-xl);
  padding: 16px;
  box-shadow: var(--shadow);
  border-left: 3px solid var(--border);
}

.record-item--success {
  border-left-color: var(--success);
}

.record-item--failed {
  border-left-color: var(--danger);
}

.record-item--processing {
  border-left-color: var(--primary);
}

.record-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.record-item__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.record-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.record-item__time {
  font-size: 12px;
  color: var(--text-3);
}

.record-item__error {
  font-size: 12px;
  color: var(--danger);
  margin-bottom: 12px;
  padding: 8px;
  background: rgba(245, 108, 108, 0.06);
  border-radius: var(--r-m);
}

.record-item__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.record-item__goto {
  font-size: 13px;
  color: var(--primary);
  text-decoration: none;
}

.record-item__delete {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--danger);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
}

.records-pagination {
  justify-content: center;
  margin-top: 12px;
}
</style>
