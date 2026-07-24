<script setup lang="ts">
import { useConfigs, useUpdateConfig, useUpdateConfigs } from '~/composables/admin'

definePageMeta({ layout: 'admin' })

const loading = ref(false)
const saving = ref(false)

// 三层架构：页面只调 composable（内含 loading / 防重 / 401-403 跳转），不裸调 request
const { execute: fetchConfigsExec } = useConfigs()
const { execute: updateConfigExec } = useUpdateConfig()
const { execute: updateConfigsExec } = useUpdateConfigs()

// ─── 单位换算 ───────────────────────────────────────────
const UNIT_OPTIONS = [
  { label: '分钟', value: 60 },
  { label: '小时', value: 3600 },
  { label: '天', value: 86400 },
  { label: '周', value: 604800 },
]

/** 秒 → { val, unit }：从大到小找第一个整除单位，否则 fallback 分钟 */
function secondsToUnit(sec: number): { val: number; unit: number } {
  for (const u of [...UNIT_OPTIONS].reverse()) {
    if (sec >= u.value && sec % u.value === 0) return { val: sec / u.value, unit: u.value }
  }
  return { val: Math.round(sec / 60), unit: 60 }
}

// ─── 评测额度 ───────────────────────────────────────────
const evalMax = ref(20)
const evalWindowVal = ref(1)
const evalWindowUnit = ref(86400)

// ─── API 限流开关 ─────────────────────────────────────────
const rateLimitEnabled = ref(true)
const rateLimitIpLevel = ref(true)
const rateLimitUserLevel = ref(true)

// ─── 上传限流 ───────────────────────────────────────────
const uploadLimitEnabled = ref(true)
const uploadMax = ref(10)
const uploadWindowVal = ref(1)
const uploadWindowUnit = ref(60)

// ─── 加载配置 ───────────────────────────────────────────
async function fetchConfigs() {
  loading.value = true
  try {
    const res = await fetchConfigsExec(null)
    if (res.code === 200 && res.data) {
      const d = res.data
      // 评测额度
      evalMax.value = parseInt(d['daily_eval_limit']?.value ?? '20', 10) || 20
      const evalWinSec = parseInt(d['eval_limit_window']?.value ?? '86400', 10) || 86400
      const evalParsed = secondsToUnit(evalWinSec)
      evalWindowVal.value = evalParsed.val
      evalWindowUnit.value = evalParsed.unit
      // API 限流
      rateLimitEnabled.value = d['rate_limit_enabled']?.value === '1'
      rateLimitIpLevel.value = d['rate_limit_ip_level']?.value === '1'
      rateLimitUserLevel.value = d['rate_limit_user_level']?.value === '1'
      // 上传限流
      uploadLimitEnabled.value = d['rate_limit_upload_enabled']?.value === '1'
      uploadMax.value = parseInt(d['rate_limit_upload_max']?.value ?? '10', 10) || 10
      const uploadWinSec = parseInt(d['rate_limit_upload_window']?.value ?? '60', 10) || 60
      const uploadParsed = secondsToUnit(uploadWinSec)
      uploadWindowVal.value = uploadParsed.val
      uploadWindowUnit.value = uploadParsed.unit
    }
  } finally {
    loading.value = false
  }
}

// ─── 保存评测额度 ─────────────────────────────────────────
async function saveEvalLimit() {
  if (evalMax.value < 0 || evalWindowVal.value < 1) {
    ElMessage.warning('请输入有效的非负整数')
    return
  }
  saving.value = true
  try {
    const windowSec = evalWindowVal.value * evalWindowUnit.value
    const res = await updateConfigsExec([
      { key: 'daily_eval_limit', value: String(evalMax.value) },
      { key: 'eval_limit_window', value: String(windowSec) },
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功')
    } else {
      ElMessage.error(res.message ?? '保存失败')
      await fetchConfigs()
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    await fetchConfigs()
  } finally {
    saving.value = false
  }
}

// ─── 保存限流开关 ─────────────────────────────────────────
async function saveRateLimitConfig(key: string, enabled: boolean) {
  try {
    const res = await updateConfigExec({ key, value: enabled ? '1' : '0' })
    if (res.code === 200) {
      ElMessage.success(res.message ?? '保存成功')
    } else {
      ElMessage.error(res.message ?? '保存失败')
      await fetchConfigs()
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    await fetchConfigs()
  }
}

// ─── 保存上传限流 ─────────────────────────────────────────
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
      await fetchConfigs()
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    await fetchConfigs()
  } finally {
    saving.value = false
  }
}

onMounted(fetchConfigs)
</script>

<template>
  <div v-loading="loading" class="page-container">
    <el-card shadow="never">
      <template #header>
        <span class="card-title">系统配置</span>
      </template>

      <!-- ═══ 评测额度 ═══ -->
      <el-divider content-position="left">评测额度</el-divider>
      <el-form label-width="140px" style="max-width: 560px">
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
              <el-option
                v-for="u in UNIT_OPTIONS"
                :key="u.value"
                :label="u.label"
                :value="u.value"
              />
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
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveEvalLimit">保存</el-button>
        </el-form-item>
      </el-form>

      <!-- ═══ API 限流 ═══ -->
      <el-divider content-position="left">API 限流</el-divider>
      <el-form label-width="140px" style="max-width: 560px">
        <el-form-item label="启用限流（总开关）">
          <el-switch
            v-model="rateLimitEnabled"
            @change="(v) => saveRateLimitConfig('rate_limit_enabled', Boolean(v))"
          />
          <div class="form-tip">关闭后所有限流检查均不生效（不推荐）。</div>
        </el-form-item>
        <el-form-item label="IP 级限流">
          <el-switch
            v-model="rateLimitIpLevel"
            @change="(v) => saveRateLimitConfig('rate_limit_ip_level', Boolean(v))"
          />
          <div class="form-tip">同一 IP 的所有用户共享请求配额，防止单 IP 滥用。</div>
        </el-form-item>
        <el-form-item label="用户级限流">
          <el-switch
            v-model="rateLimitUserLevel"
            @change="(v) => saveRateLimitConfig('rate_limit_user_level', Boolean(v))"
          />
          <div class="form-tip">每个登录用户独立配额，避免同 IP 多用户互相影响。</div>
        </el-form-item>
      </el-form>

      <!-- ═══ 上传限流 ═══ -->
      <el-divider content-position="left">上传限流</el-divider>
      <el-form label-width="140px" style="max-width: 560px">
        <el-form-item label="启用上传限流">
          <el-switch
            v-model="uploadLimitEnabled"
            @change="(v) => saveRateLimitConfig('rate_limit_upload_enabled', Boolean(v))"
          />
          <div class="form-tip">独立于全局限流开关。关闭后上传材料请求不受限流检查。</div>
        </el-form-item>
        <el-form-item label="频率限制">
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
              <el-option
                v-for="u in UNIT_OPTIONS"
                :key="u.value"
                :label="u.label"
                :value="u.value"
              />
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
  </div>
</template>

<style scoped>
.page-container {
  padding: 20px;
}
.card-title {
  font-size: 16px;
  font-weight: 600;
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
