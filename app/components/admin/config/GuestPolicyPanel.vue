<script setup lang="ts">
import { useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'

/** 游客策略配置面板（音频/评测额度 + 数据保留 + 单日学习时长上限） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const guestDailyAudioLimit = ref(20)
const guestDailyEvalLimit = ref(1)
const guestRetentionDays = ref(180)
// 游客单日学习时长上限（秒；此前无 UI 的隐藏键，本次补全）
const guestDailyStudyCap = ref(14400)

function init() {
  const d = props.configMap
  guestDailyAudioLimit.value = parseInt(d['guest_daily_audio_limit']?.value ?? '20', 10) || 20
  guestDailyEvalLimit.value = parseInt(d['guest_daily_eval_limit']?.value ?? '1', 10) || 0
  guestRetentionDays.value = parseInt(d['guest_retention_days']?.value ?? '180', 10) || 180
  guestDailyStudyCap.value = parseInt(d['guest_daily_study_cap']?.value ?? '14400', 10) || 14400
}

watch(() => props.configMap, init, { immediate: true })

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

async function save() {
  if (
    guestDailyAudioLimit.value < 1 ||
    guestDailyEvalLimit.value < 0 ||
    guestRetentionDays.value < 30 ||
    guestDailyStudyCap.value < 1
  ) {
    ElMessage.warning('请输入有效的限制值')
    return
  }
  saving.value = true
  try {
    const res = await updateConfigsExec([
      { key: 'guest_daily_audio_limit', value: String(guestDailyAudioLimit.value) },
      { key: 'guest_daily_eval_limit', value: String(guestDailyEvalLimit.value) },
      { key: 'guest_retention_days', value: String(guestRetentionDays.value) },
      { key: 'guest_daily_study_cap', value: String(guestDailyStudyCap.value) },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，对游客立即生效')
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
        <span class="card-title">游客策略</span>
        <span class="card-sub">游客访问频率限制、学习时长与数据保留策略</span>
      </div>
    </template>
    <el-form label-width="140px">
      <el-form-item label="每日音频下载次数">
        <el-input-number
          v-model="guestDailyAudioLimit"
          :min="1"
          :max="9999"
          :step="1"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">游客每天可获取音频签名 URL 的次数上限，控制 OSS 流量成本。</div>
      </el-form-item>
      <el-form-item label="每日评测次数限制">
        <el-input-number
          v-model="guestDailyEvalLimit"
          :min="0"
          :max="9999"
          :step="1"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">
          游客每天可使用配音评测和影子跟读评测的次数（各自独立计数），0 表示完全禁用。
        </div>
      </el-form-item>
      <el-form-item label="单日学习时长">
        <div class="study-cap-row">
          <el-input-number
            v-model="guestDailyStudyCap"
            :min="60"
            :max="86400"
            :step="600"
            controls-position="right"
            style="width: 140px"
          />
          <span class="window-label">秒</span>
        </div>
        <div class="form-tip">游客单日累计学习时长的上限（防刷），超出后当日不再累计学习时长。</div>
      </el-form-item>
      <el-form-item label="数据保留天数">
        <el-input-number
          v-model="guestRetentionDays"
          :min="30"
          :max="3650"
          :step="1"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">
          过期游客数据（未转正的游客账户及其学习记录）的保留天数，超过后自动清理。
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
.study-cap-row {
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
