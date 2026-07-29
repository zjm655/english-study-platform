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

// ─── 上传限制（时长/大小/队列深度，前后端校验共用同一契约）──
const uploadDurationUser = ref(180)
const uploadDurationAdmin = ref(600)
const uploadSizeUser = ref(2097152)
const uploadSizeAdmin = ref(5242880)
const uploadRecordingMaxSize = ref(52428800)
const uploadQueueMax = ref(50)

/** 字节 → MB 提示文案（整数直显，非整数保留 1 位小数） */
function bytesToMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

// ─── 语音识别 STT ────────────────────────────────────────
const sttBackend = ref<'filetrans' | 'flash'>('filetrans')
const sttTrialStartDate = ref<string | null>(null)

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
      // 上传限制（默认值与后端 uploadLimitChecker 一致）
      uploadDurationUser.value = parseInt(d['upload_max_duration_user']?.value ?? '180', 10) || 180
      uploadDurationAdmin.value =
        parseInt(d['upload_max_duration_admin']?.value ?? '600', 10) || 600
      uploadSizeUser.value = parseInt(d['upload_max_size_user']?.value ?? '2097152', 10) || 2097152
      uploadSizeAdmin.value =
        parseInt(d['upload_max_size_admin']?.value ?? '5242880', 10) || 5242880
      uploadRecordingMaxSize.value =
        parseInt(d['upload_recording_max_size']?.value ?? '52428800', 10) || 52428800
      uploadQueueMax.value = parseInt(d['upload_queue_max']?.value ?? '50', 10) || 50
      // 语音识别 STT（试用日期 '-' 占位视为未填）
      sttBackend.value = d['stt_backend']?.value === 'flash' ? 'flash' : 'filetrans'
      const rawTrialDate = d['stt_trial_start_date']?.value ?? '-'
      sttTrialStartDate.value = /^\d{4}-\d{2}-\d{2}$/.test(rawTrialDate) ? rawTrialDate : null
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

// ─── 保存上传限制 ─────────────────────────────────────────
async function saveUploadLimitsConfig() {
  const vals = [
    uploadDurationUser.value,
    uploadDurationAdmin.value,
    uploadSizeUser.value,
    uploadSizeAdmin.value,
    uploadRecordingMaxSize.value,
    uploadQueueMax.value,
  ]
  if (vals.some((v) => v < 1 || !Number.isInteger(v))) {
    ElMessage.warning('请输入有效的正整数')
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
    ])
    if (res.code === 200) {
      ElMessage.success('保存成功，5 分钟内对上传校验生效')
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

// ─── 保存语音识别 STT ─────────────────────────────────────
async function saveSttConfig() {
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

      <!-- ═══ 上传限制 ═══ -->
      <el-card shadow="never" class="config-card">
        <template #header>
          <div class="card-head">
            <span class="card-title">上传限制</span>
            <span class="card-sub">上传/录音的时长、大小与队列深度上限（保存后 5 分钟内生效）</span>
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
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="saveUploadLimitsConfig">
              保存
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- ═══ 语音识别 STT ═══ -->
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
            <el-button type="primary" :loading="saving" @click="saveSttConfig">保存</el-button>
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
