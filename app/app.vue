<script setup lang="ts">
useSeoMeta({
  titleTemplate:"%s | 我的官网",
  description:"nuxt4-demo",
  keywords:"aiofis"
})

// 加载语音评测 SDK（仅在客户端）
useHead({
  script: [
    { src: '/sdk/engine.js', defer: true, tagPosition: 'bodyClose' }
  ]
})

</script>

<template>
  <NuxtLayout>
    <NuxtPage/>
  </NuxtLayout>

</template>
