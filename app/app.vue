<script setup lang="ts">
useSeoMeta({
  titleTemplate: `%s · ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
