<script setup lang="ts">
import { useUpdateConfig, useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'
import { secondsToUnit, UNIT_OPTIONS } from '~/utils/configFormat'

/** 流量与限流配置面板（API 全局限流开关 + 上传限流） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

// API 限流开关
const rateLimitEnabled = ref(true)
const rateLimitIpLevel = ref(true)
const rateLimitUserLevel = ref(true)

// 上传限流
const uploadLimitEnabled = ref(true)
const uploadMax = ref(10)
const uploadWindowVal = ref(1)
const uploadWindowUnit = ref(60)

function init() {
  const d = props.configMap
  rateLimitEnabled.value = d['rate_limit_enabled']?.value === '1'
  rateLimitIpLevel.value = d['rate_limit_ip_level']?.value === '1'
  rateLimitUserLevel.value = d['rate_limit_user_level']?.value === '1'
  uploadLimitEnabled.value = d['rate_limit_upload_enabled']?.value === '1'
  uploadMax.value = parseInt(d['rate_limit_upload_max']?.value ?? '10', 10) || 10
  const uploadWinSec = parseInt(d['rate_limit_upload_window']?.value ?? '60', 10) || 60
  const uploadParsed = secondsToUnit(uploadWinSec)
  uploadWindowVal.value = uploadParsed.val
  uploadWindowUnit.value = uploadParsed.unit
}

watch(() => props.configMap, init, { immediate: true })

const { execute: updateConfigExec } = useUpdateConfig()

/** 开关类配置：改动即保存 */
async function saveSwitch(key: string, enabled: boolean) {
  try {
    const res = await updateConfigExec({ key, value: enabled ? '1' : '0' })
    if (res.code === 200) {
      ElMessage.success(res.message ?? '保存成功')
    } else {
      ElMessage.error(res.message ?? '保存失败')
      emit('refresh')
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    emit('refresh')
  }
}

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

/** 上传限流窗口组保存 */
async function saveUploadLimit() {
  if (uploadMax.value < 1 || uploadWindowVal.value < 1) {
    ElMessage.warning('请输入有效的正整数')
    return
  }
  saving.value = true
  try {
    const windowSec = uploadWindowVal.value * uploadWindowUnit.value
    const res = await updateConfigsExec([
      { key: 'rate_limit_upload_max', value: String(uploadMax.value) },
      { key: 'rate_limit_upload_window', value: String(windowSec) },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功')
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
        <span class="card-title">API 限流</span>
        <span class="card-sub">全局请求频率保护</span>
      </div>
    </template>
    <el-form label-width="110px">
      <el-form-item label="总开关">
        <el-switch
          v-model="rateLimitEnabled"
          @change="(v) => saveSwitch('rate_limit_enabled', Boolean(v))"
        />
        <div class="form-tip">关闭后所有限流检查均不生效（不推荐）。</div>
      </el-form-item>
      <el-form-item label="IP 级限流">
        <el-switch
          v-model="rateLimitIpLevel"
          @change="(v) => saveSwitch('rate_limit_ip_level', Boolean(v))"
        />
        <div class="form-tip">同一 IP 的所有用户共享请求配额，防止单 IP 滥用。</div>
      </el-form-item>
      <el-form-item label="用户级限流">
        <el-switch
          v-model="rateLimitUserLevel"
          @change="(v) => saveSwitch('rate_limit_user_level', Boolean(v))"
        />
        <div class="form-tip">每个登录用户独立配额，避免同 IP 多用户互相影响。</div>
      </el-form-item>
      <el-divider />
      <el-form-item label="上传限流">
        <el-switch
          v-model="uploadLimitEnabled"
          active-text="开启"
          inactive-text="关闭"
          @change="(v) => saveSwitch('rate_limit_upload_enabled', Boolean(v))"
        />
        <div class="form-tip">独立于全局限流开关。关闭后上传材料请求不受限流检查。</div>
      </el-form-item>
      <el-form-item label="上传频率">
        <div class="window-row">
          <span class="window-label">每</span>
          <el-input-number
            v-model="uploadWindowVal"
            :min="1"
            :max="999"
            :step="1"
            controls-position="right"
            style="width: 100px"
          />
          <el-select v-model="uploadWindowUnit" style="width: 80px">
            <el-option v-for="u in UNIT_OPTIONS" :key="u.value" :label="u.label" :value="u.value" />
          </el-select>
          <span class="window-label">最多</span>
          <el-input-number
            v-model="uploadMax"
            :min="1"
            :max="999"
            :step="1"
            controls-position="right"
            style="width: 100px"
          />
          <span class="window-label">次</span>
        </div>
        <div class="form-tip">每个用户在时间窗口内可发起的上传材料请求数上限。</div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="saveUploadLimit">保存</el-button>
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
.window-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.window-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
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
