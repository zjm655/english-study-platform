<script setup lang="ts">
import { useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'
import { bytesToMB } from '~/utils/configFormat'

/** 上传与资源配置面板（音频时长/大小 × 管理员用户双档 + 录音大小 + 队列深度 + 文本长度上下限 × 双档） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

// 音频限制
const uploadDurationUser = ref(180)
const uploadDurationAdmin = ref(600)
const uploadSizeUser = ref(2097152)
const uploadSizeAdmin = ref(5242880)
const uploadRecordingMaxSize = ref(52428800)
const uploadQueueMax = ref(50)

// 文本长度限制（sys_config 040，管理员/用户分档上下限）
const minTextUser = ref(10)
const maxTextUser = ref(5000)
const minTextAdmin = ref(10)
const maxTextAdmin = ref(5000)

function init() {
  const d = props.configMap
  uploadDurationUser.value = parseInt(d['upload_max_duration_user']?.value ?? '180', 10) || 180
  uploadDurationAdmin.value = parseInt(d['upload_max_duration_admin']?.value ?? '600', 10) || 600
  uploadSizeUser.value = parseInt(d['upload_max_size_user']?.value ?? '2097152', 10) || 2097152
  uploadSizeAdmin.value = parseInt(d['upload_max_size_admin']?.value ?? '5242880', 10) || 5242880
  uploadRecordingMaxSize.value =
    parseInt(d['upload_recording_max_size']?.value ?? '52428800', 10) || 52428800
  uploadQueueMax.value = parseInt(d['upload_queue_max']?.value ?? '50', 10) || 50
  minTextUser.value = parseInt(d['upload_min_text_user']?.value ?? '10', 10) || 10
  maxTextUser.value = parseInt(d['upload_max_text_user']?.value ?? '5000', 10) || 5000
  minTextAdmin.value = parseInt(d['upload_min_text_admin']?.value ?? '10', 10) || 10
  maxTextAdmin.value = parseInt(d['upload_max_text_admin']?.value ?? '5000', 10) || 5000
}

watch(() => props.configMap, init, { immediate: true })

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

async function save() {
  const vals = [
    uploadDurationUser.value,
    uploadDurationAdmin.value,
    uploadSizeUser.value,
    uploadSizeAdmin.value,
    uploadRecordingMaxSize.value,
    uploadQueueMax.value,
    minTextUser.value,
    maxTextUser.value,
    minTextAdmin.value,
    maxTextAdmin.value,
  ]
  if (vals.some((v) => v < 1 || !Number.isInteger(v))) {
    ElMessage.warning('请输入有效的正整数')
    return
  }
  // 语义校验：上限必须 ≥ 下限（防配置倒挂导致所有上传被拒）
  if (
    maxTextUser.value < minTextUser.value ||
    maxTextAdmin.value < minTextAdmin.value ||
    uploadDurationAdmin.value < uploadDurationUser.value ||
    uploadSizeAdmin.value < uploadSizeUser.value
  ) {
    ElMessage.warning('管理员档位不得低于用户档位，上限不得低于下限')
    return
  }
  saving.value = true
  try {
    const res = await updateConfigsExec([
      { key: 'upload_max_duration_user', value: String(uploadDurationUser.value) },
      { key: 'upload_max_duration_admin', value: String(uploadDurationAdmin.value) },
      { key: 'upload_max_size_user', value: String(uploadSizeUser.value) },
      { key: 'upload_max_size_admin', value: String(uploadSizeAdmin.value) },
      { key: 'upload_recording_max_size', value: String(uploadRecordingMaxSize.value) },
      { key: 'upload_queue_max', value: String(uploadQueueMax.value) },
      { key: 'upload_min_text_user', value: String(minTextUser.value) },
      { key: 'upload_max_text_user', value: String(maxTextUser.value) },
      { key: 'upload_min_text_admin', value: String(minTextAdmin.value) },
      { key: 'upload_max_text_admin', value: String(maxTextAdmin.value) },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，5 分钟内对上传校验生效')
    } else {
      ElMessage.error(res.message ?? '保存失败')
      emit('refresh')
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    emit('refresh')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-card shadow="never" class="config-card">
    <template #header>
      <div class="card-head">
        <span class="card-title">上传限制</span>
        <span class="card-sub"
          >音频时长/大小与文本长度上下限（管理员/用户分档，保存后 5 分钟内生效）</span
        >
      </div>
    </template>
    <el-form label-width="140px">
      <el-form-item label="用户音频时长">
        <el-input-number
          v-model="uploadDurationUser"
          :min="1"
          :max="86400"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">普通用户上传/录制音频的最大时长（单位：秒）。</div>
      </el-form-item>
      <el-form-item label="管理员音频时长">
        <el-input-number
          v-model="uploadDurationAdmin"
          :min="1"
          :max="86400"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">管理员上传/录制音频的最大时长（单位：秒）。</div>
      </el-form-item>
      <el-form-item label="用户音频大小">
        <el-input-number
          v-model="uploadSizeUser"
          :min="1"
          :step="1048576"
          controls-position="right"
          style="width: 160px"
        />
        <div class="form-tip">
          普通用户音频最大字节数（单位：字节），当前约 {{ bytesToMB(uploadSizeUser) }}。
        </div>
      </el-form-item>
      <el-form-item label="管理员音频大小">
        <el-input-number
          v-model="uploadSizeAdmin"
          :min="1"
          :step="1048576"
          controls-position="right"
          style="width: 160px"
        />
        <div class="form-tip">
          管理员音频最大字节数（单位：字节），当前约 {{ bytesToMB(uploadSizeAdmin) }}。
        </div>
      </el-form-item>
      <el-form-item label="录音文件大小">
        <el-input-number
          v-model="uploadRecordingMaxSize"
          :min="1"
          :step="1048576"
          controls-position="right"
          style="width: 160px"
        />
        <div class="form-tip">
          跟读/配音录音上传的大小上限（单位：字节），当前约
          {{ bytesToMB(uploadRecordingMaxSize) }}。
        </div>
      </el-form-item>
      <el-form-item label="队列深度上限">
        <el-input-number
          v-model="uploadQueueMax"
          :min="1"
          :max="999"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">材料上传队列的待处理任务数上限，超出时拒绝新任务入队。</div>
      </el-form-item>
      <el-divider />
      <el-form-item label="用户文本长度">
        <div class="text-range-row">
          <el-input-number
            v-model="minTextUser"
            :min="1"
            :max="99999"
            controls-position="right"
            style="width: 110px"
          />
          <span class="window-label">~</span>
          <el-input-number
            v-model="maxTextUser"
            :min="1"
            :max="100000"
            controls-position="right"
            style="width: 110px"
          />
          <span class="window-label">字符</span>
        </div>
        <div class="form-tip">普通用户上传材料文本的字数上下限（含标题提取后的正文校验）。</div>
      </el-form-item>
      <el-form-item label="管理员文本长度">
        <div class="text-range-row">
          <el-input-number
            v-model="minTextAdmin"
            :min="1"
            :max="99999"
            controls-position="right"
            style="width: 110px"
          />
          <span class="window-label">~</span>
          <el-input-number
            v-model="maxTextAdmin"
            :min="1"
            :max="100000"
            controls-position="right"
            style="width: 110px"
          />
          <span class="window-label">字符</span>
        </div>
        <div class="form-tip">
          管理员上传材料文本的字数上下限（单条与批量 txt 共用）。该上限同时作为 AI
          内容生成的输入上限，调大后 AI 调用随之放宽。
        </div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.card-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.card-sub {
  font-size: 12px;
  color: var(--text-4);
}
.window-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.text-range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-tip {
  display: block;
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
