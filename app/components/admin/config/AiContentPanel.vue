<script setup lang="ts">
import { useUpdateConfigs } from '~/composables/admin'
import type { AdminConfigMap } from '~/api/admin/config'

/** AI 内容生成配置面板（DeepSeek 超时与 max_tokens，仅此一项，默认直接展开） */
const props = defineProps<{ configMap: AdminConfigMap }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const deepseekTimeoutSec = ref(120)
const deepseekTitleTimeoutSec = ref(60)
const deepseekMaxTokens = ref(4000)
const deepseekTitleMaxTokens = ref(200)
// 管理员上传 DeepSeek 主审核开关（默认开）
const adminModerationEnabled = ref(true)

function init() {
  const d = props.configMap
  const rawContentMs = parseInt(d['deepseek_timeout_ms']?.value ?? '', 10)
  deepseekTimeoutSec.value = rawContentMs > 0 ? Math.round(rawContentMs / 1000) : 120
  const rawTitleMs = parseInt(d['deepseek_title_timeout_ms']?.value ?? '', 10)
  deepseekTitleTimeoutSec.value = rawTitleMs > 0 ? Math.round(rawTitleMs / 1000) : 60
  deepseekMaxTokens.value = parseInt(d['deepseek_max_tokens']?.value ?? '4000', 10) || 4000
  deepseekTitleMaxTokens.value = parseInt(d['deepseek_title_max_tokens']?.value ?? '200', 10) || 200
  // 键缺失/非法均按开启处理（fail-closed，与 moderationConfig 兜底一致）
  adminModerationEnabled.value = (d['admin_moderation_enabled']?.value ?? '1') === '1'
}

watch(() => props.configMap, init, { immediate: true })

const saving = ref(false)
const { execute: updateConfigsExec } = useUpdateConfigs()

async function save() {
  const vals = [deepseekTimeoutSec.value, deepseekTitleTimeoutSec.value]
  if (vals.some((v) => v < 5 || v > 600 || !Number.isInteger(v))) {
    ElMessage.warning('请输入 5–600 的整数（单位：秒）')
    return
  }
  if (
    !Number.isInteger(deepseekMaxTokens.value) ||
    deepseekMaxTokens.value < 100 ||
    deepseekMaxTokens.value > 160000
  ) {
    ElMessage.warning('请输入 100–160000 的整数（内容生成 max tokens）')
    return
  }
  if (
    !Number.isInteger(deepseekTitleMaxTokens.value) ||
    deepseekTitleMaxTokens.value < 50 ||
    deepseekTitleMaxTokens.value > 40000
  ) {
    ElMessage.warning('请输入 50–40000 的整数（标题生成 max tokens）')
    return
  }
  saving.value = true
  try {
    const res = await updateConfigsExec([
      { key: 'deepseek_timeout_ms', value: String(deepseekTimeoutSec.value * 1000) },
      { key: 'deepseek_title_timeout_ms', value: String(deepseekTitleTimeoutSec.value * 1000) },
      { key: 'deepseek_max_tokens', value: String(deepseekMaxTokens.value) },
      { key: 'deepseek_title_max_tokens', value: String(deepseekTitleMaxTokens.value) },
      { key: 'admin_moderation_enabled', value: adminModerationEnabled.value ? '1' : '0' },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，对后续 DeepSeek 调用立即生效')
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
        <span class="card-title">AI 内容生成</span>
        <span class="card-sub">DeepSeek 调用超时与输出上限</span>
      </div>
    </template>
    <el-form label-width="140px">
      <el-form-item label="管理员上传审核">
        <el-switch v-model="adminModerationEnabled" active-text="启用" inactive-text="关闭" />
        <div class="form-tip">
          管理员上传材料时以 DeepSeek 审核（要求英文、非字幕时间轴，服务不可用即拒绝）作为主闸门；关闭后仅保留正则与 NLS 相似度校验。
        </div>
      </el-form-item>
      <el-form-item label="内容生成超时">
        <el-input-number
          v-model="deepseekTimeoutSec"
          :min="5"
          :max="600"
          :step="5"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">
          学习内容生成（翻译/词汇/理解题）的单次调用超时，单位：秒，保存后即时生效。
        </div>
      </el-form-item>
      <el-form-item label="标题生成超时">
        <el-input-number
          v-model="deepseekTitleTimeoutSec"
          :min="5"
          :max="600"
          :step="5"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">中文标题生成的单次调用超时，单位：秒，保存后即时生效。</div>
      </el-form-item>
      <el-form-item label="内容生成 max tokens">
        <el-input-number
          v-model="deepseekMaxTokens"
          :min="100"
          :max="160000"
          :step="100"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">
          学习内容生成的单次最大输出 token 数（默认
          4000），保存后即时生效；输出较长材料若出现内容截断可调大。
        </div>
      </el-form-item>
      <el-form-item label="标题生成 max tokens">
        <el-input-number
          v-model="deepseekTitleMaxTokens"
          :min="50"
          :max="40000"
          :step="50"
          controls-position="right"
          style="width: 140px"
        />
        <div class="form-tip">中文标题生成的单次最大输出 token 数（默认 200）。</div>
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
.form-tip {
  display: block;
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
