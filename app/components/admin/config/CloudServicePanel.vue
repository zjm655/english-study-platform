<script setup lang="ts">
import { useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'

/** 云服务配置面板（并发队列[高级设置折叠] + STT 后端） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

// 云服务并发队列（0=不限流）
const queueTts = ref(4)
const queueNls = ref(2)
const queueDeepseek = ref(3)
const queueUpload = ref(2)
// 高级设置折叠（默认收起）
const advOpen = ref<string[]>([])

// STT
const sttBackend = ref<'filetrans' | 'flash'>('filetrans')
const sttTrialStartDate = ref<string | null>(null)

function init() {
  const d = props.configMap
  queueTts.value = parseInt(d['queue_tts_concurrency']?.value ?? '4', 10) || 0
  queueNls.value = parseInt(d['queue_nls_concurrency']?.value ?? '2', 10) || 0
  queueDeepseek.value = parseInt(d['queue_deepseek_concurrency']?.value ?? '3', 10) || 0
  queueUpload.value = parseInt(d['queue_upload_concurrency']?.value ?? '2', 10) || 0
  sttBackend.value = d['stt_backend']?.value === 'flash' ? 'flash' : 'filetrans'
  const rawTrialDate = d['stt_trial_start_date']?.value ?? '-'
  sttTrialStartDate.value = /^\d{4}-\d{2}-\d{2}$/.test(rawTrialDate) ? rawTrialDate : null
}

watch(() => props.configMap, init, { immediate: true })

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

/** 保存队列并发（高级设置） */
async function saveQueue() {
  const vals = [queueTts.value, queueNls.value, queueDeepseek.value, queueUpload.value]
  if (vals.some((v) => v < 0 || !Number.isInteger(v))) {
    ElMessage.warning('请输入有效的非负整数（0=不限流）')
    return
  }
  saving.value = true
  try {
    const res = await updateConfigsExec([
      { key: 'queue_tts_concurrency', value: String(queueTts.value) },
      { key: 'queue_nls_concurrency', value: String(queueNls.value) },
      { key: 'queue_deepseek_concurrency', value: String(queueDeepseek.value) },
      { key: 'queue_upload_concurrency', value: String(queueUpload.value) },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，新并发数对后续任务立即生效')
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

/** 保存 STT 配置 */
async function saveStt() {
  saving.value = true
  try {
    const res = await updateConfigsExec([
      { key: 'stt_backend', value: sttBackend.value },
      // PUT 校验 value 非空：未填日期用 '-' 占位（后端/监控解析非日期即视为未设置）
      { key: 'stt_trial_start_date', value: sttTrialStartDate.value || '-' },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，对后续上传任务立即生效')
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
        <span class="card-title">语音识别（STT）</span>
        <span class="card-sub"
          >材料上传音频转文字的后端选择（额度尽/试用到期等自动回退极速版）</span
        >
      </div>
    </template>
    <el-form label-width="140px">
      <el-form-item label="识别后端">
        <el-select v-model="sttBackend" style="width: 260px">
          <el-option value="filetrans" label="标准版 filetrans（每日 120 分钟免费）" />
          <el-option value="flash" label="极速版 flash（商用按量计费）" />
        </el-select>
        <div class="form-tip">
          标准版为异步识别（分钟级），命中额度超限/试用到期/并发超限/下载失败/超时会自动回退极速版，不改此配置。
        </div>
      </el-form-item>
      <el-form-item label="试用开通日期">
        <el-date-picker
          v-model="sttTrialStartDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择 NLS 服务开通日期"
          style="width: 260px"
        />
        <div class="form-tip">免费试用期 3 个月，运行监控页据此展示到期倒计时。</div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="saveStt">保存</el-button>
      </el-form-item>
    </el-form>

    <el-collapse v-model="advOpen" class="adv-collapse">
      <el-collapse-item title="高级设置：云服务并发队列" name="adv">
        <el-form label-width="140px">
          <el-form-item label="Edge TTS">
            <el-input-number
              v-model="queueTts"
              :min="0"
              :max="99"
              controls-position="right"
              style="width: 120px"
            />
            <div class="form-tip">文本转语音并发上限。0 = 不限流。</div>
          </el-form-item>
          <el-form-item label="NLS 语音识别">
            <el-input-number
              v-model="queueNls"
              :min="0"
              :max="99"
              controls-position="right"
              style="width: 120px"
            />
            <div class="form-tip">阿里云试用版配额通常为 2，请按控制台实际配额调整。</div>
          </el-form-item>
          <el-form-item label="DeepSeek">
            <el-input-number
              v-model="queueDeepseek"
              :min="0"
              :max="99"
              controls-position="right"
              style="width: 120px"
            />
            <div class="form-tip">含内容审核/内容生成/标题生成三类调用。</div>
          </el-form-item>
          <el-form-item label="上传流水线">
            <el-input-number
              v-model="queueUpload"
              :min="0"
              :max="99"
              controls-position="right"
              style="width: 120px"
            />
            <div class="form-tip">同时处理的材料上传任务数（每任务驻留约 5MB 内存）。</div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveQueue">保存</el-button>
          </el-form-item>
        </el-form>
      </el-collapse-item>
    </el-collapse>
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
.form-tip {
  display: block;
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
.adv-collapse {
  margin-top: 12px;
}
</style>
