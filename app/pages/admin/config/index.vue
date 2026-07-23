<script setup lang="ts">
import { adminConfigPath } from '~/api/paths'
import { request } from '~/utils/request'

definePageMeta({ layout: 'admin' })

const loading = ref(false)
const saving = ref(false)
const configs = ref<Record<string, { value: string; description: string | null }>>({})

// 表单数据
const dailyLimit = ref(20)

// API 限流开关
const rateLimitEnabled = ref(true)
const rateLimitIpLevel = ref(true)
const rateLimitUserLevel = ref(true)

// 上传材料限流（独立于全局限流开关）
const uploadLimitEnabled = ref(true)
const uploadLimitMax = ref(10)
const uploadLimitWindow = ref(60)

async function fetchConfigs() {
  loading.value = true
  try {
    const res =
      await request<Record<string, { value: string; description: string | null }>>(adminConfigPath)
    if (res.code === 200 && res.data) {
      configs.value = res.data
      dailyLimit.value = parseInt(res.data['daily_eval_limit']?.value ?? '20', 10) || 20
      rateLimitEnabled.value = res.data['rate_limit_enabled']?.value === '1'
      rateLimitIpLevel.value = res.data['rate_limit_ip_level']?.value === '1'
      rateLimitUserLevel.value = res.data['rate_limit_user_level']?.value === '1'
      uploadLimitEnabled.value = res.data['rate_limit_upload_enabled']?.value === '1'
      uploadLimitMax.value = parseInt(res.data['rate_limit_upload_max']?.value ?? '10', 10) || 10
      uploadLimitWindow.value =
        parseInt(res.data['rate_limit_upload_window']?.value ?? '60', 10) || 60
    }
  } finally {
    loading.value = false
  }
}

async function saveDailyLimit() {
  if (dailyLimit.value < 0) {
    ElMessage.warning('请输入有效的非负整数')
    return
  }
  saving.value = true
  try {
    const res = await request(adminConfigPath, {
      method: 'PUT',
      body: { key: 'daily_eval_limit', value: String(dailyLimit.value) },
    })
    if (res.code === 200) {
      ElMessage.success(res.message ?? '保存成功')
    } else {
      ElMessage.error(res.message ?? '保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function saveRateLimitConfig(key: string, enabled: boolean) {
  try {
    const res = await request(adminConfigPath, {
      method: 'PUT',
      body: { key, value: enabled ? '1' : '0' },
    })
    if (res.code === 200) {
      ElMessage.success(res.message ?? '保存成功')
    } else {
      ElMessage.error(res.message ?? '保存失败')
      // 保存失败时回滚开关状态（重新加载）
      await fetchConfigs()
    }
  } catch {
    ElMessage.error('网络异常，保存失败')
    await fetchConfigs()
  }
}

async function saveUploadLimit() {
  if (uploadLimitMax.value < 1 || uploadLimitWindow.value < 1) {
    ElMessage.warning('请输入有效的正整数')
    return
  }
  saving.value = true
  try {
    const [resMax, resWindow] = await Promise.all([
      request(adminConfigPath, {
        method: 'PUT',
        body: { key: 'rate_limit_upload_max', value: String(uploadLimitMax.value) },
      }),
      request(adminConfigPath, {
        method: 'PUT',
        body: { key: 'rate_limit_upload_window', value: String(uploadLimitWindow.value) },
      }),
    ])
    if (resMax.code === 200 && resWindow.code === 200) {
      ElMessage.success('保存成功')
    } else {
      ElMessage.error(resMax.message ?? resWindow.message ?? '保存失败')
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

      <el-form label-width="180px" style="max-width: 500px">
        <el-form-item label="每日评测次数上限">
          <el-input-number
            v-model="dailyLimit"
            :min="0"
            :max="999"
            :step="5"
            controls-position="right"
          />
          <div class="form-tip">
            普通用户每天可进行的评测次数（配音 + 跟读），管理员不受限制。设为 0 表示不限制。
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveDailyLimit">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <span class="card-title">API 限流配置</span>
      </template>

      <el-form label-width="180px" style="max-width: 500px">
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
    </el-card>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header>
        <span class="card-title">上传材料限流配置</span>
      </template>

      <el-form label-width="180px" style="max-width: 500px">
        <el-form-item label="启用上传限流">
          <el-switch
            v-model="uploadLimitEnabled"
            @change="(v) => saveRateLimitConfig('rate_limit_upload_enabled', Boolean(v))"
          />
          <div class="form-tip">独立于全局限流开关。关闭后上传材料请求不受限流检查。</div>
        </el-form-item>
        <el-form-item label="窗口内最大请求数">
          <el-input-number
            v-model="uploadLimitMax"
            :min="1"
            :max="999"
            :step="1"
            controls-position="right"
          />
          <div class="form-tip">每个用户在时间窗口内可发起的上传材料请求数上限。</div>
        </el-form-item>
        <el-form-item label="时间窗口（秒）">
          <el-input-number
            v-model="uploadLimitWindow"
            :min="1"
            :max="3600"
            :step="10"
            controls-position="right"
          />
          <div class="form-tip">限流统计的时间窗口大小（秒），常用 60 秒。</div>
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
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
