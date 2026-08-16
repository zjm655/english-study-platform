<script setup lang="ts">
import { useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'
import { secondsToUnit, UNIT_OPTIONS } from '~/utils/configFormat'

/** 评测服务配置面板（额度 / 窗口 / 并发闸门 / 估算窗口） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const evalMax = ref(20)
const evalWindowVal = ref(1)
const evalWindowUnit = ref(86400)
const evalGateMax = ref(20)
// 评测并发闸门估算窗口（秒；此前无 UI 的隐藏键，本次补全）
const evalGateWindow = ref(300)

function init() {
  const d = props.configMap
  evalMax.value = parseInt(d['daily_eval_limit']?.value ?? '20', 10) || 20
  const evalWinSec = parseInt(d['eval_limit_window']?.value ?? '86400', 10) || 86400
  const evalParsed = secondsToUnit(evalWinSec)
  evalWindowVal.value = evalParsed.val
  evalWindowUnit.value = evalParsed.unit
  evalGateMax.value = parseInt(d['eval_gate_max']?.value ?? '20', 10) || 0
  evalGateWindow.value = parseInt(d['eval_gate_window']?.value ?? '300', 10) || 300
}

watch(() => props.configMap, init, { immediate: true })

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

async function save() {
  if (evalMax.value < 0 || evalWindowVal.value < 1 || evalGateWindow.value < 1) {
    ElMessage.warning('请输入有效的非负整数')
    return
  }
  saving.value = true
  try {
    const windowSec = evalWindowVal.value * evalWindowUnit.value
    const res = await updateConfigsExec([
      { key: 'daily_eval_limit', value: String(evalMax.value) },
      { key: 'eval_limit_window', value: String(windowSec) },
      { key: 'eval_gate_max', value: String(evalGateMax.value) },
      { key: 'eval_gate_window', value: String(evalGateWindow.value) },
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
        <span class="card-title">评测额度</span>
        <span class="card-sub">普通用户评测频率与并发闸门</span>
      </div>
    </template>
    <el-form label-width="110px">
      <el-form-item label="额度限制">
        <div class="window-row">
          <span class="window-label">每</span>
          <el-input-number
            v-model="evalWindowVal"
            :min="1"
            :max="999"
            :step="1"
            controls-position="right"
            style="width: 100px"
          />
          <el-select v-model="evalWindowUnit" style="width: 80px">
            <el-option v-for="u in UNIT_OPTIONS" :key="u.value" :label="u.label" :value="u.value" />
          </el-select>
          <span class="window-label">最多</span>
          <el-input-number
            v-model="evalMax"
            :min="0"
            :max="999"
            :step="5"
            controls-position="right"
            style="width: 100px"
          />
          <span class="window-label">次</span>
        </div>
        <div class="form-tip">
          普通用户在时间窗口内可进行的评测次数（配音 + 跟读），管理员不受限制。设为 0 表示不限制。
        </div>
      </el-form-item>
      <el-form-item label="并发闸门">
        <el-input-number
          v-model="evalGateMax"
          :min="0"
          :max="999"
          :step="5"
          controls-position="right"
          style="width: 120px"
        />
        <div class="form-tip">
          全局同时进行的评测数上限（按窗口发放估算），超出提示稍后重试。设为 0 表示不限制。
        </div>
      </el-form-item>
      <el-form-item label="估算窗口">
        <el-input-number
          v-model="evalGateWindow"
          :min="1"
          :max="3600"
          :step="30"
          controls-position="right"
          style="width: 120px"
        />
        <div class="form-tip">
          并发闸门的估算窗口（秒），建议等于评测 warrantId 有效期（默认 300s）。
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
