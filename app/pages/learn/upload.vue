<script setup lang="ts">
import type { UploadFile, UploadFiles } from 'element-plus'
import { ArrowLeft, Delete, View, Upload  } from '@element-plus/icons-vue'
import { useUploadMaterial } from '~/composables/material/useUploadMaterial'
import { useMaterialRecords, useDeleteMaterialRecord } from '~/composables/material/useUploadRecords'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { MaterialUploadRecordListItem } from '#shared/types/material'
</script>

<template>
  <div class="upload-page">
    <div class="upload-page__header">
      <button class="back-btn" @click="router.push('/learn')">
        <el-icon><ArrowLeft /></el-icon>
      </button>
      <h2 class="upload-page__title">上传自定义材料</h2>
    </div>

    <form class="upload-form" @submit.prevent="handleSubmit">
      <!-- 英文材料 -->
      <div class="form-section">
        <label class="form-label">英文材料 <span class="required">*</span></label>
        <el-input
          v-model="textContent"
          type="textarea"
          :rows="8"
          placeholder="请输入英文学习材料..."
          :maxlength="MAX_TEXT_LENGTH"
          show-word-limit
        />
        <div v-if="textContent.length > 0 && textContent.length < MIN_TEXT_LENGTH" class="form-hint error">
          至少输入 {{ MIN_TEXT_LENGTH }} 个字符
        </div>
      </div>

      <!-- 朗读音色 -->
      <div class="form-section">
        <label class="form-label">朗读音色</label>
        <el-select v-model="selectedVoice" style="width: 100%">
          <el-option
            v-for="opt in VOICE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <p class="form-desc">未上传音频时，将使用所选音色自动生成语音</p>
      </div>

      <!-- 音频文件 -->
      <div class="form-section">
        <label class="form-label">音频文件（可选）</label>
        <p class="form-desc">不上传则自动生成语音，上传的音频需与材料内容匹配</p>
        <el-upload
          :auto-upload="false"
          :limit="1"
          accept=".mp3,.wav,.aac,.opus"
          :on-change="handleAudioChange"
          :on-remove="handleAudioRemove"
          drag
        >
          <el-icon class="upload-icon"><Upload /></el-icon>
          <div class="el-upload__text">拖拽或点击上传</div>
          <template #tip>
            <div class="el-upload__tip">支持 MP3/WAV/AAC/OPUS，最大 2MB</div>
          </template>
        </el-upload>
      </div>

      <!-- 是否公开 -->
      <div class="form-section">
        <label class="form-label">可见范围 <span class="required">*</span></label>
        <el-radio-group v-model="isPublic">
          <el-radio :value="1">公开</el-radio>
          <el-radio :value="0">仅自己可见</el-radio>
        </el-radio-group>
      </div>

      <!-- 提交 -->
      <div class="form-actions">
        <el-button
          type="primary"
          :loading="isLoading"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          {{ isLoading ? '处理中（约 15-30 秒）...' : '提交材料' }}
        </el-button>
      </div>
    </form>

    <!-- 最近上传记录 -->
    <div class="recent-records">
      <div class="recent-records__header">
        <h3 class="recent-records__title">最近上传</h3>
        <NuxtLink to="/learn/records" class="recent-records__more">
          查看更多
        </NuxtLink>
      </div>

      <div v-if="recordsLoading" class="recent-records__loading">加载中...</div>

      <div v-else-if="!recentRecords.length" class="recent-records__empty">
        暂无上传记录
      </div>

      <div v-else class="recent-records__list">
        <div
          v-for="record in recentRecords"
          :key="record.id"
          class="record-card"
          :class="{
            'record-card--success': record.status === 'success',
            'record-card--failed': record.status === 'failed',
            'record-card--processing': record.status === 'processing',
          }"
        >
          <div class="record-card__main">
            <div class="record-card__title">{{ record.title }}</div>
            <div class="record-card__meta">
              <el-tag :type="getStatusType(record.status)" size="small">
                {{ getStatusLabel(record.status) }}
              </el-tag>
              <span class="record-card__time">{{ formatTime(record.createdAt) }}</span>
            </div>
            <div v-if="record.error_message" class="record-card__error">
              {{ record.error_message }}
            </div>
          </div>

          <div class="record-card__actions">
            <NuxtLink
              v-if="record.segment_id"
              :to="`/learn/unit/0#segment-${record.segment_id}`"
              class="record-action"
              title="去学习"
            >
              <el-icon><View /></el-icon>
            </NuxtLink>
            <button
              class="record-action record-action--danger"
              title="删除"
              @click="handleDeleteRecord(record.id)"
            >
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">


definePageMeta({ title: '上传材料' })

const router = useRouter()
const { isLoading, execute } = useUploadMaterial()
const { isLoading: recordsLoading, execute: fetchRecords } = useMaterialRecords()
const { execute: doDelete } = useDeleteMaterialRecord()

const textContent = ref('')
const audioFile = ref<File | null>(null)
const isPublic = ref<1>(1)

/** 可选朗读音色列表 */
const VOICE_OPTIONS = [
  { value: 'en-US-AriaNeural', label: 'Aria — 美式女声（默认）' },
  { value: 'en-US-GuyNeural', label: 'Guy — 美式男声' },
  { value: 'en-US-JennyNeural', label: 'Jenny — 美式女声' },
  { value: 'en-GB-SoniaNeural', label: 'Sonia — 英式女声' },
  { value: 'en-GB-RyanNeural', label: 'Ryan — 英式男声' },
] as const

const selectedVoice = ref<string>('en-US-AriaNeural')

const MAX_TEXT_LENGTH = 5000
const MIN_TEXT_LENGTH = 10
const MAX_AUDIO_SIZE = 2 * 1024 * 1024

const textTooLong = computed(() => textContent.value.length > MAX_TEXT_LENGTH)
const canSubmit = computed(
  () => !isLoading.value
    && textContent.value.length >= MIN_TEXT_LENGTH
    && !textTooLong.value
    && (!audioFile.value || audioFile.value.size <= MAX_AUDIO_SIZE)
)

const recentRecords = ref<MaterialUploadRecordListItem[]>([])

async function loadRecentRecords() {
  const res = await fetchRecords({ limit: 3 })
  if (res?.code === 200 && res.data) {
    recentRecords.value = res.data
  }
}

onMounted(() => {
  loadRecentRecords()
})

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function getStatusType(status: string) {
  switch (status) {
    case 'success': return 'success'
    case 'failed': return 'danger'
    default: return 'info'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'success': return '成功'
    case 'failed': return '失败'
    case 'processing': return '处理中'
    default: return status
  }
}

async function handleDeleteRecord(id: number) {
  try {
    await ElMessageBox.confirm('确定删除这条记录吗？关联的学习数据也会被清理。', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const res = await doDelete(id)
    if (res?.code === 200) {
      recentRecords.value = recentRecords.value.filter(r => r.id !== id)
      if (recentRecords.value.length < 3) {
        loadRecentRecords()
      }
    }
  } catch {
    // 用户取消
  }
}

function handleAudioChange(_uploadFile: UploadFile, uploadFiles: UploadFiles) {
  const file = uploadFiles[0]
  if (!file?.raw) return
  if (file.raw.size > MAX_AUDIO_SIZE) {
    ElMessage.warning('音频文件不能超过 2MB')
    return
  }
  audioFile.value = file.raw
}

function handleAudioRemove() {
  audioFile.value = null
}

async function handleSubmit() {
  if (!canSubmit.value) return

  const formData = new FormData()
  formData.append('textContent', textContent.value)
  formData.append('isPublic', String(isPublic.value))
  formData.append('voice', selectedVoice.value)
  if (audioFile.value) {
    formData.append('audio', audioFile.value)
  }

  const res = await execute(formData)
  if (res.code === 200 && res.data) {
    ElMessage.success('材料上传成功，正在处理中...')
    router.push('/learn')
  }
}
export default { components: { Upload } }
</script>

<style scoped>
.upload-page {
  padding: 12px;
  max-width: 640px;
  margin: 0 auto;
}

.upload-page__header {
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

.upload-page__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0;
}

.upload-form {
  background: var(--card);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow);
  padding: 20px;
}

.form-section {
  margin-bottom: 20px;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 8px;
}

.required {
  color: var(--danger);
}

.form-hint {
  font-size: 12px;
  margin-top: 4px;
  color: var(--text-3);
}

.form-hint.error {
  color: var(--danger);
}

.form-desc {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 8px;
}

:deep(.el-upload-dragger) {
  width: 100%;
}

.upload-icon {
  font-size: 32px;
  color: var(--text-3);
  margin-bottom: 8px;
}

.form-actions {
  padding-top: 8px;
}

/* ========== 最近上传记录 ========== */
.recent-records {
  margin-top: 20px;
  background: var(--card);
  border-radius: var(--r-xl);
  box-shadow: var(--shadow);
  padding: 20px;
}

.recent-records__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.recent-records__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0;
}

.recent-records__more {
  font-size: 13px;
  color: var(--primary);
  text-decoration: none;
}

.recent-records__loading,
.recent-records__empty {
  text-align: center;
  padding: 20px;
  font-size: 14px;
  color: var(--text-3);
}

.recent-records__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px;
  border-radius: var(--r-l);
  border-left: 3px solid var(--border);
  background: var(--bg);
  transition: background 0.2s;
}

.record-card--success {
  border-left-color: var(--success);
}

.record-card--failed {
  border-left-color: var(--danger);
}

.record-card--processing {
  border-left-color: var(--primary);
}

.record-card__main {
  flex: 1;
  min-width: 0;
}

.record-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.record-card__time {
  font-size: 12px;
  color: var(--text-3);
}

.record-card__error {
  font-size: 12px;
  color: var(--danger);
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.record-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
}

.record-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--r-m);
  color: var(--text-3);
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}

.record-action:hover {
  color: var(--primary);
  background: var(--border-ll);
}

.record-action--danger:hover {
  color: var(--danger);
}
</style>