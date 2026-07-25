<script setup lang="ts">
import { usePermission } from '~/composables/user'
import { PERMISSIONS } from '#shared/utils/permission'

definePageMeta({ layout: 'admin' })

// 访问 /admin/logs 根路径时按权限分流：有 VIEW_LOGS 去首个常规日志子页；
// 仅持 VIEW_AUDIT 者去审核留痕（避免被守卫弹回首页）
if (import.meta.client) {
  const { can } = usePermission()
  const target = can(PERMISSIONS.VIEW_LOGS) ? '/admin/logs/api-call' : '/admin/logs/review-access'
  await navigateTo(target, { redirectCode: 301 })
}
</script>

<template>
  <div class="redirecting">
    <p>正在跳转到日志子页...</p>
  </div>
</template>

<style scoped>
.redirecting {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
}
</style>
