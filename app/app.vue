<script setup lang="ts">
import { SITE_NAME, SITE_DESCRIPTION } from '~/utils/seo'

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
