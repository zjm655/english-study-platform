<script setup lang="ts">
import type { UploadFile, UploadFiles } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { useUploadMaterial } from '~/composables/material/useUploadMaterial'
import { ElMessage } from 'element-plus'

definePageMeta({ title: '上传材料' })

const router = useRouter()
const { isLoading, execute } = useUploadMaterial()

const textContent = ref('')
const audioFile = ref<File | null>(null)
const isPublic = ref<1>(1)

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
  if (audioFile.value) {
    formData.append('audio', audioFile.value)
  }

  const res = await execute(formData)
  if (res.code === 200 && res.data) {
    ElMessage.success('材料上传成功，正在处理中...')
    router.push('/learn')
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
          :maxlength="MAX_TEXT_LENGTH"
          show-word-limit
        />
        <div v-if="textContent.length > 0 && textContent.length < MIN_TEXT_LENGTH" class="form-hint error">
          至少输入 {{ MIN_TEXT_LENGTH }} 个字符
        </div>
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
  </div>
</template>

<script lang="ts">
import { Upload } from '@element-plus/icons-vue'
export default { components: { Upload } }
</script>

<style scoped>
.upload-page {
  padding: 16px;
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
  padding: 24px;
}

.form-section {
  margin-bottom: 24px;
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
</style>