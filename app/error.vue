<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const router = useRouter()

function handleBack() {
  clearError({ redirect: '/' })
}

function handleRetry() {
  clearError()
}
</script>

<template>
  <div class="error-page">
    <div class="error-card">
      <div class="error-code">{{ error.statusCode || 500 }}</div>
      <h1 class="error-title">
        {{ error.statusCode === 404 ? '页面未找到' : '出错了' }}
      </h1>
      <p class="error-message">
        {{ error.message || '请稍后再试' }}
      </p>
      <div class="error-actions">
        <button
          v-if="error.statusCode === 404"
          class="error-btn error-btn--primary"
          @click="handleBack"
        >
          返回首页
        </button>
        <button v-else class="error-btn error-btn--primary" @click="handleRetry">重试</button>
      </div>
      <div v-if="error.statusCode !== 404" v-show="error.stack" class="error-detail">
        <details>
          <summary>技术细节</summary>
          <pre>{{ error.stack }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--bg);
}

.error-card {
  text-align: center;
  max-width: 400px;
}

.error-code {
  font-size: 72px;
  font-weight: 700;
  color: var(--primary);
  line-height: 1;
}

.error-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1);
  margin-top: 12px;
}

.error-message {
  font-size: 14px;
  color: var(--text-3);
  margin-top: 8px;
}

.error-actions {
  margin-top: 24px;
}

.error-btn {
  padding: 10px 28px;
  border: none;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.error-btn--primary {
  background: var(--primary);
  color: #fff;
}

.error-detail {
  margin-top: 24px;
  text-align: left;
  font-size: 12px;
  color: var(--text-4);
}

.error-detail pre {
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
