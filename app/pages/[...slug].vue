<script setup lang="ts">
// Nuxt 4 catch-all 路由：当没有任何路由匹配时触发
// 抛出 404 错误，由 app/error.vue 渲染
throw createError({ statusCode: 404, message: '您访问的页面不存在' })
</script>

<template>
  <!-- 不会被渲染，createError 会触发 error.vue -->
</template>
