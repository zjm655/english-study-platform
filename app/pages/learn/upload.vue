<script setup lang="ts">
import type { UploadFile, UploadFiles } from 'element-plus'
import { ArrowLeft, Delete, View, Upload } from '@element-plus/icons-vue'
import { useUploadMaterial } from '~/composables/material/useUploadMaterial'
import {
  useMaterialRecords,
  useMaterialRecordStatuses,
  useDeleteMaterialRecord,
} from '~/composables/material/useUploadRecords'
import type { MaterialUploadRecordListItem } from '#shared/types/material'

definePageMeta({ title: '上传材料' })

useSeoMeta({
  title: '上传材料',
  description: '上传自定义英语文本或音频，AI 自动生成翻译、词汇、题目与配音训练材料。',
})

const router = useRouter()
const { isLoading, execute } = useUploadMaterial()
const { isLoading: recordsLoading, execute: fetchRecords } = useMaterialRecords()
const { execute: doDelete } = useDeleteMaterialRecord()

const textContent = ref('')
const audioFile = ref<File | null>(null)
const isPublic = ref<1>(1)
const titleMode = ref<'ai' | 'manual' | 'audio_filename' | 'inline'>('ai')
const manualTitle = ref('')

/** 可选朗读音色列表 */
const VOICE_OPTIONS = [
  { value: 'en-US-AriaNeural', label: 'Aria — 美式女声（默认）' },
  { value: 'en-US-GuyNeural', label: 'Guy — 美式男声' },
  { value: 'en-US-JennyNeural', label: 'Jenny — 美式女声' },
  { value: 'en-GB-SoniaNeural', label: 'Sonia — 英式女声' },
  { value: 'en-GB-RyanNeural', label: 'Ryan — 英式男声' },
] as const

const selectedVoice = ref<string>('en-US-AriaNeural')

// 文本长度限制来自 sys_config（管理端可调，普通用户档）：composable 未就绪时降级内置默认
const maxTextLength = computed(
  () => uploadLimits.value?.maxTextUser ?? UPLOAD_LIMITS_FALLBACK.maxTextUser,
)
const minTextLength = computed(
  () => uploadLimits.value?.minTextUser ?? UPLOAD_LIMITS_FALLBACK.minTextUser,
)

// 上传限制来自 sys_config（管理端可调）：composable 未就绪/拉取失败时降级内置静态默认
const { limits: uploadLimits } = useUploadLimits()
const maxAudioSize = computed(
  () => uploadLimits.value?.maxAudioSizeUser ?? UPLOAD_LIMITS_FALLBACK.maxAudioSizeUser,
)

/** 字节 → MB 展示文案（整数直显，非整数保留 1 位小数） */
function formatSizeMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
}

const textTooLong = computed(() => textContent.value.length > maxTextLength.value)
const canSubmit = computed(
  () =>
    !isLoading.value &&
    textContent.value.length >= minTextLength.value &&
    !textTooLong.value &&
    (!audioFile.value || audioFile.value.size <= maxAudioSize.value),
)

const recentRecords = ref<MaterialUploadRecordListItem[]>([])

async function loadRecentRecords(silent = false) {
  const res = await fetchRecords({ limit: 3 }, { silent })
  // 轮询与手动刷新并发时防重锁返回 code -2，直接忽略本轮
  if (res?.code === 200 && res.data) {
    recentRecords.value = res.data
  }
}

// ─── 异步任务轮询（usePolling 指数衰减 3s→30s）：活跃项走批量状态轻接口增量合并，
// 转终态时整刷一次列表（拿 segment_id/AI 标题），全部终态后自动停止 ───
const { execute: fetchStatuses } = useMaterialRecordStatuses()

const hasActiveRecord = computed(() =>
  recentRecords.value.some((r) => r.status === 'queued' || r.status === 'processing'),
)

function activeRecordIds() {
  return recentRecords.value
    .filter((r) => r.status === 'queued' || r.status === 'processing')
    .map((r) => r.id)
}

const {
  start: startPolling,
  stop: stopPolling,
  reset: resetPolling,
} = usePolling(async () => {
  const ids = activeRecordIds()
  if (!ids.length) return true
  const res = await fetchStatuses(ids, { silent: true })
  // 轮询与手动刷新并发时防重锁返回 code -2，直接忽略本轮
  if (res?.code === 200 && res.data) {
    let reachedTerminal = false
    for (const item of res.data) {
      const target = recentRecords.value.find((r) => r.id === item.id)
      if (!target) continue
      if (
        target.status !== item.status &&
        (item.status === 'success' || item.status === 'failed')
      ) {
        reachedTerminal = true
      }
      target.status = item.status
      target.error_message = item.error_message
      target.segment_id = item.segment_id
      target.title = item.title
      target.queuedAhead = item.queuedAhead
    }
    if (reachedTerminal) await loadRecentRecords(true)
  }
  return !hasActiveRecord.value
})

watch(hasActiveRecord, (active) => {
  if (active) startPolling()
  else stopPolling()
})

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
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    case 'queued':
      return 'warning'
    default:
      return 'info'
  }
}

function getStatusLabel(record: MaterialUploadRecordListItem) {
  switch (record.status) {
    case 'success':
      return '成功'
    case 'failed':
      return '失败'
    case 'processing':
      return '处理中'
    case 'queued':
      return record.queuedAhead ? `排队中（前方 ${record.queuedAhead} 个）` : '排队中'
    default:
      return record.status
  }
}

async function handleDeleteRecord(id: number) {
  try {
    await toastConfirm('确定删除这条记录吗？关联的学习数据也会被清理。', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const res = await doDelete(id)
    if (res?.code === 200) {
      recentRecords.value = recentRecords.value.filter((r) => r.id !== id)
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
  if (file.raw.size > maxAudioSize.value) {
    toastWarning(`音频文件不能超过 ${formatSizeMB(maxAudioSize.value)}`)
    return
  }
  audioFile.value = file.raw
}

function handleAudioRemove() {
  audioFile.value = null
}

async function handleSubmit() {
  if (!canSubmit.value) return

  // 标题生成方式前置校验：手动填写须非空、音频文件名须先上传音频
  if (titleMode.value === 'manual' && !manualTitle.value.trim()) {
    toastWarning('请填写标题')
    return
  }
  if (titleMode.value === 'audio_filename' && !audioFile.value) {
    toastWarning('请先上传音频文件')
    return
  }

  const formData = new FormData()
  formData.append('textContent', textContent.value)
  formData.append('isPublic', String(isPublic.value))
  formData.append('voice', selectedVoice.value)
  formData.append('titleMode', titleMode.value)
  if (titleMode.value === 'manual') {
    formData.append('title', manualTitle.value.trim())
  } else if (titleMode.value === 'audio_filename') {
    formData.append('fileName', audioFile.value?.name ?? '')
  }
  if (audioFile.value) {
    formData.append('audio', audioFile.value)
  }

  const res = await execute(formData)
  if (res.code === 200 && res.data) {
    toastSuccess(
      res.data.queuePosition > 0
        ? `已加入处理队列，前方还有 ${res.data.queuePosition} 个任务`
        : '已加入处理队列，预计 1-2 分钟完成',
    )
    // 标题被截取等提示透传展示
    if (res.data.notice) {
      toastWarning(res.data.notice)
    }
    // 不再跳转：留在本页通过「最近上传」轮询展示排队/处理进度
    textContent.value = ''
    audioFile.value = null
    titleMode.value = 'ai'
    manualTitle.value = ''
    await loadRecentRecords()
    // 新任务入队：重置衰减回起始间隔快轮（未在轮询中则等价启动）
    resetPolling()
  }
}
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
          :maxlength="maxTextLength"
          show-word-limit
        />
        <div
          v-if="textContent.length > 0 && textContent.length < minTextLength"
          class="form-hint error"
        >
          至少输入 {{ minTextLength }} 个字符
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
            <div class="el-upload__tip">
              支持 MP3/WAV/AAC/OPUS，最大 {{ formatSizeMB(maxAudioSize) }}
            </div>
          </template>
        </el-upload>
      </div>

      <!-- 标题 -->
      <div class="form-section">
        <label class="form-label">标题</label>
        <el-radio-group v-model="titleMode" class="title-mode-group">
          <el-radio value="ai">AI 生成</el-radio>
          <el-radio value="manual">手动填写</el-radio>
          <el-radio value="audio_filename" :disabled="!audioFile">音频文件名</el-radio>
          <el-radio value="inline">正文 # 标题</el-radio>
        </el-radio-group>
        <div v-if="titleMode === 'manual'" class="form-title-input">
          <el-input
            v-model="manualTitle"
            placeholder="请输入标题..."
            maxlength="100"
            show-word-limit
          />
        </div>
        <p v-else-if="titleMode === 'ai'" class="form-desc">
          AI 根据内容生成，失败时截取正文前 50 字符
        </p>
        <p v-else-if="titleMode === 'audio_filename'" class="form-desc">
          将使用音频文件名作为标题（超过 50 字符自动截取）
        </p>
        <p v-else-if="titleMode === 'inline'" class="form-desc">
          正文第一行以「# 」开头即作为标题，例如「# A Day at the Park」
        </p>
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
        <el-button type="primary" :loading="isLoading" :disabled="!canSubmit" @click="handleSubmit">
          {{ isLoading ? '提交中...' : '提交材料' }}
        </el-button>
      </div>
    </form>

    <!-- 最近上传记录 -->
    <div class="recent-records">
      <div class="recent-records__header">
        <h3 class="recent-records__title">最近上传</h3>
        <NuxtLink to="/learn/records" class="recent-records__more"> 查看更多 </NuxtLink>
      </div>

      <div v-if="recordsLoading" class="recent-records__loading">加载中...</div>

      <div v-else-if="!recentRecords.length" class="recent-records__empty">暂无上传记录</div>

      <div v-else class="recent-records__list">
        <div
          v-for="record in recentRecords"
          :key="record.id"
          class="record-card"
          :class="{
            'record-card--success': record.status === 'success',
            'record-card--failed': record.status === 'failed',
            'record-card--processing': record.status === 'processing' || record.status === 'queued',
          }"
        >
          <div class="record-card__main">
            <div class="record-card__title">{{ record.title }}</div>
            <div class="record-card__meta">
              <el-tag :type="getStatusType(record.status)" size="small">
                {{ getStatusLabel(record) }}
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

/* 标题模式 radio 组：窄容器（app-wrapper 限宽 430px）下换行排列，避免超宽错乱 */
.title-mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
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

.form-title-input {
  margin-top: 8px;
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
  transition:
    color 0.2s,
    background 0.2s;
}

.record-action:hover {
  color: var(--primary);
  background: var(--border-ll);
}

.record-action--danger:hover {
  color: var(--danger);
}
</style>
