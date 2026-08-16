<script setup lang="ts">
import { useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'

/** 日志与监控配置面板（归档 + 前端错误上报 + 云健康检测[折叠] + 孤儿音频保留） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

// 日志归档与前端错误上报
const logArchiveEnabled = ref(true)
const logArchiveIntervalDays = ref(1)
const logArchiveRetentionDays = ref(30)
const clientErrorReportEnabled = ref(true)

// 云健康检测与资源清理（此前无 UI 的隐藏键，本次补全；低频折叠）
const cloudHealthWindowMin = ref(5)
const cloudHealthFailThresholdPct = ref(50)
const cloudHealthMinFailures = ref(5)
const orphanAudioRetentionDays = ref(7)
const advOpen = ref<string[]>([])

function init() {
  const d = props.configMap
  logArchiveEnabled.value = d['log_archive_auto_enabled']?.value !== '0'
  logArchiveIntervalDays.value =
    parseInt(d['log_archive_auto_interval_days']?.value ?? '1', 10) || 1
  logArchiveRetentionDays.value = parseInt(d['log_archive_retention_days']?.value ?? '30', 10) || 30
  clientErrorReportEnabled.value = d['client_error_report_enabled']?.value !== '0'
  cloudHealthWindowMin.value = parseInt(d['cloud_health_window_min']?.value ?? '5', 10) || 5
  cloudHealthFailThresholdPct.value =
    parseInt(d['cloud_health_fail_threshold_pct']?.value ?? '50', 10) || 50
  cloudHealthMinFailures.value = parseInt(d['cloud_health_min_failures']?.value ?? '5', 10) || 5
  orphanAudioRetentionDays.value = parseInt(d['orphan_audio_retention_days']?.value ?? '7', 10) || 7
}

watch(() => props.configMap, init, { immediate: true })

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

async function save() {
  if (
    !Number.isInteger(logArchiveIntervalDays.value) ||
    logArchiveIntervalDays.value < 1 ||
    logArchiveIntervalDays.value > 365
  ) {
    ElMessage.warning('执行间隔请输入 1–365 的整数（天）')
    return
  }
  if (
    !Number.isInteger(logArchiveRetentionDays.value) ||
    logArchiveRetentionDays.value < 7 ||
    logArchiveRetentionDays.value > 3650
  ) {
    ElMessage.warning('保留阈值请输入 7–3650 的整数（天）')
    return
  }
  if (
    !Number.isInteger(cloudHealthWindowMin.value) ||
    cloudHealthWindowMin.value < 1 ||
    cloudHealthWindowMin.value > 60 ||
    !Number.isInteger(cloudHealthFailThresholdPct.value) ||
    cloudHealthFailThresholdPct.value < 1 ||
    cloudHealthFailThresholdPct.value > 100 ||
    !Number.isInteger(cloudHealthMinFailures.value) ||
    cloudHealthMinFailures.value < 1 ||
    cloudHealthMinFailures.value > 1000 ||
    !Number.isInteger(orphanAudioRetentionDays.value) ||
    orphanAudioRetentionDays.value < 1 ||
    orphanAudioRetentionDays.value > 365
  ) {
    ElMessage.warning('云健康/清理参数请输入有效范围值')
    return
  }
  saving.value = true
  try {
    const res = await updateConfigsExec([
      { key: 'log_archive_auto_enabled', value: logArchiveEnabled.value ? '1' : '0' },
      { key: 'log_archive_auto_interval_days', value: String(logArchiveIntervalDays.value) },
      { key: 'log_archive_retention_days', value: String(logArchiveRetentionDays.value) },
      { key: 'client_error_report_enabled', value: clientErrorReportEnabled.value ? '1' : '0' },
      { key: 'cloud_health_window_min', value: String(cloudHealthWindowMin.value) },
      { key: 'cloud_health_fail_threshold_pct', value: String(cloudHealthFailThresholdPct.value) },
      { key: 'cloud_health_min_failures', value: String(cloudHealthMinFailures.value) },
      { key: 'orphan_audio_retention_days', value: String(orphanAudioRetentionDays.value) },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，自动归档将在下个周期按新配置执行')
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
        <span class="card-title">日志维护</span>
        <span class="card-sub">自动归档可随时取消；关闭后手动归档按钮仍可用</span>
      </div>
    </template>
    <el-form label-width="140px">
      <el-form-item label="自动归档">
        <el-switch v-model="logArchiveEnabled" />
        <div class="form-tip">
          开启后每日检查，把超过「保留阈值」天前的日志迁入归档表（幂等，重复执行安全）。
        </div>
      </el-form-item>
      <el-form-item label="执行间隔">
        <el-input-number
          v-model="logArchiveIntervalDays"
          :min="1"
          :max="365"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">每隔 N 天执行一次归档，单位：天（默认 1 = 每日）。</div>
      </el-form-item>
      <el-form-item label="保留阈值">
        <el-input-number
          v-model="logArchiveRetentionDays"
          :min="7"
          :max="3650"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">迁走超过 N 天前的日志（默认 30，与文件日志保留天数同口径）。</div>
      </el-form-item>
      <el-form-item label="前端错误上报">
        <el-switch v-model="clientErrorReportEnabled" />
        <div class="form-tip">
          浏览器 JS 错误 / 未捕获 Promise 拒绝上报服务端（节流防风暴，写入告警事件表）。
        </div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </el-form-item>
    </el-form>

    <el-collapse v-model="advOpen" class="adv-collapse">
      <el-collapse-item title="高级设置：云健康检测与资源清理" name="adv">
        <el-form label-width="140px">
          <el-form-item label="检测窗口">
            <el-input-number
              v-model="cloudHealthWindowMin"
              :min="1"
              :max="60"
              controls-position="right"
              style="width: 140px"
            />
            <div class="form-tip">云失败率骤升检测的统计窗口（分钟，1-60）。</div>
          </el-form-item>
          <el-form-item label="失败率阈值">
            <el-input-number
              v-model="cloudHealthFailThresholdPct"
              :min="1"
              :max="100"
              controls-position="right"
              style="width: 140px"
            />
            <div class="form-tip">窗口内云调用失败率超过该百分比触发告警事件（1-100）。</div>
          </el-form-item>
          <el-form-item label="最少失败条数">
            <el-input-number
              v-model="cloudHealthMinFailures"
              :min="1"
              :max="1000"
              controls-position="right"
              style="width: 140px"
            />
            <div class="form-tip">窗口内最少失败条数，防低频误报（1-1000）。</div>
          </el-form-item>
          <el-form-item label="孤儿音频保留">
            <el-input-number
              v-model="orphanAudioRetentionDays"
              :min="1"
              :max="365"
              controls-position="right"
              style="width: 140px"
            />
            <div class="form-tip">
              失败上传记录关联音频的保留天数，超期未重处理则清理 OSS 孤儿对象。
            </div>
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
