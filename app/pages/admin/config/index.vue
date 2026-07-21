<script setup lang="ts">
import { adminConfigPath } from '~/api/paths'
import { request } from '~/utils/request'

definePageMeta({ layout: 'admin' })

const loading = ref(false)
const saving = ref(false)
const configs = ref<Record<string, { value: string; description: string | null }>>({})

// 表单数据
const dailyLimit = ref(20)

async function fetchConfigs() {
  loading.value = true
  try {
    const res = await request<Record<string, { value: string; description: string | null }>>(adminConfigPath)
    if (res.code === 0 && res.data) {
      configs.value = res.data
      dailyLimit.value = parseInt(res.data['daily_eval_limit']?.value ?? '20', 10) || 20
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
    if (res.code === 0) {
      ElMessage.success(res.message ?? '保存成功')
    } else {
      ElMessage.error(res.message ?? '保存失败')
    }
  } finally {
    saving.value = false
  }
}

onMounted(fetchConfigs)
</script>

<template>
  <div class="page-container" v-loading="loading">
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
