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
// 全局评测并发闸门（0=不限制）
const evalGateMax = ref(20)

// ─── API 限流开关 ─────────────────────────────────────────
const rateLimitEnabled = ref(true)
const rateLimitIpLevel = ref(true)
const rateLimitUserLevel = ref(true)

// ─── 上传限流 ───────────────────────────────────────────
const uploadLimitEnabled = ref(true)
const uploadMax = ref(10)
const uploadWindowVal = ref(1)
const uploadWindowUnit = ref(60)

// ─── 云服务并发队列（0=不限流）───────────────────────────
const queueTts = ref(4)
const queueNls = ref(2)
const queueDeepseek = ref(3)
const queueUpload = ref(2)

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
      evalGateMax.value = parseInt(d['eval_gate_max']?.value ?? '20', 10) || 0
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
      // 云服务并发队列
      queueTts.value = parseInt(d['queue_tts_concurrency']?.value ?? '4', 10) || 0
      queueNls.value = parseInt(d['queue_nls_concurrency']?.value ?? '2', 10) || 0
      queueDeepseek.value = parseInt(d['queue_deepseek_concurrency']?.value ?? '3', 10) || 0
      queueUpload.value = parseInt(d['queue_upload_concurrency']?.value ?? '2', 10) || 0
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
      { key: 'eval_gate_max', value: String(evalGateMax.value) },
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

// ─── 保存队列并发 ─────────────────────────────────────
async function saveQueueConfig() {
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
      await fetchConfigs()
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    await fetchConfigs()
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-loading="loading" class="config-page">
    <div class="config-header">
      <h2 class="config-page-title">系统配置</h2>
      <p class="config-desc">调整评测额度、API 限流与上传限流等全局策略，保存后即时生效。</p>
    </div>

    <div class="config-grid">
      <!-- ═══ 评测额度 ═══ -->
      <el-card shadow="never" class="config-card">
        <template #header>
          <div class="card-head">
            <span class="card-title">评测额度</span>
            <span class="card-sub">普通用户评测频率上限</span>
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
              普通用户在时间窗口内可进行的评测次数（配音 + 跟读），管理员不受限制。设为 0
              表示不限制。
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
              全局同时进行的评测数上限（按近 5 分钟鉴权发放估算，含管理员），超出提示稍后重试。设为
              0 表示不限制。
            </div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveEvalLimit">保存</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- ═══ API 限流 ═══ -->
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
      </el-card>

      <!-- ═══ 上传限流 ═══ -->
      <el-card shadow="never" class="config-card">
        <template #header>
          <div class="card-head">
            <span class="card-title">上传限流</span>
            <span class="card-sub">上传材料请求频率</span>
          </div>
        </template>
        <el-form label-width="110px">
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

      <!-- ═══ 云服务并发队列 ═══ -->
      <el-card shadow="never" class="config-card">
        <template #header>
          <div class="card-head">
            <span class="card-title">云服务并发队列</span>
            <span class="card-sub">各云产品同时调用数上限（超出部分在本机内存队列排队）</span>
          </div>
        </template>
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
            <el-button type="primary" :loading="saving" @click="saveQueueConfig">保存</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.config-page {
  padding: 20px;
}
.config-header {
  margin-bottom: 16px;
}
.config-page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
}
.config-desc {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-3);
}
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
  gap: 16px;
  align-items: start;
}
.config-card {
  border-radius: var(--r-lg);
  height: 100%;
}
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
