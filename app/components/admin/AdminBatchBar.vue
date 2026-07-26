<script setup lang="ts">
/**
 * 管理后台批量操作条：选中数 > 0 时浮现，展示「已选 N 项（仅当前页）」+
 * 操作按钮插槽 + 清空选择。配套 useTableSelection 使用。
 */
defineProps<{ count: number }>()

const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div v-if="count > 0" class="admin-batch-bar">
    <span class="admin-batch-bar__count">已选 {{ count }} 项（仅当前页）</span>
    <div class="admin-batch-bar__actions">
      <slot />
    </div>
    <el-button link size="small" @click="emit('clear')">清空选择</el-button>
  </div>
</template>

<style scoped>
.admin-batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
}

.admin-batch-bar__count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.admin-batch-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
}
</style>
