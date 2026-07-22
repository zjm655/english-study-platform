<script setup lang="ts">
definePageMeta({ layout: 'admin' })

// 访问 /admin/logs 根路径时重定向到第一个子页
if (import.meta.client) {
  await navigateTo('/admin/logs/api-call', { redirectCode: 301 })
}
</script>

<template>
  <div class="redirecting">
    <p>正在跳转到 API 调用日志...</p>
  </div>
</template>

<style scoped>
.redirecting {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
}
</style>
