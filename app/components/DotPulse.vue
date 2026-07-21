<script setup lang="ts">
interface Props {
  size?: number
  gap?: number
  color?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 10,
  gap: 8,
  color: 'var(--primary)',
})
</script>

<template>
  <div class="dot-pulse" :style="{ gap: `${gap}px` }">
    <span
      v-for="i in 3"
      :key="i"
      class="dot"
      :style="{
        width: `${size}px`,
        height: `${size}px`,
        background: color,
        animationDelay: `${(i - 1) * 0.2}s`,
      }"
    />
  </div>
</template>

<style scoped>
.dot-pulse {
  display: flex;
  align-items: center;
}

.dot-pulse .dot {
  border-radius: 50%;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
