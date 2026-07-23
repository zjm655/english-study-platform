<script setup lang="ts">
defineProps<{
  title: string
  desc: string
}>()
</script>

<template>
  <div class="phase-panel__title">{{ title }}</div>
  <div class="phase-panel__desc">{{ desc }}</div>
</template>

<style scoped>
.phase-panel__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.phase-panel__desc {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 20px;
}
</style>
