<script setup lang="ts" generic="T extends { id: number }">
/**
 * 管理后台批量操作条：选中数 > 0 时浮现，展示「已选 N 项（含其他页 M 项）」+
 * 操作按钮插槽 + 已选清单弹层（rows 传入时可查看/逐项移除，含其他页行）+ 清空选择。
 * 配套 useTableSelection（reserve-selection 跨页保留）使用；新 props 均可选，
 * count-only 的旧用法行为不变。
 */
const props = defineProps<{
  count: number
  /** 选中集中不在当前页的行数（>0 时文案追加「含其他页 M 项」） */
  offPageCount?: number
  /** 全量选中行（传入后显示「查看已选」弹层，可逐项移除） */
  rows?: T[]
  /** 弹层每行的展示文案（缺省只显示 #id） */
  rowLabel?: (row: T) => string
}>()

const emit = defineEmits<{ clear: []; remove: [row: T] }>()

const listVisible = ref(false)

// rows 被移空时自动关闭弹层
watch(
  () => props.count,
  (n) => {
    if (n === 0) listVisible.value = false
  },
)
</script>

<template>
  <div v-if="count > 0" class="admin-batch-bar">
    <span class="admin-batch-bar__count">
      已选 {{ count }} 项<template v-if="offPageCount">（含其他页 {{ offPageCount }} 项）</template>
    </span>
    <div class="admin-batch-bar__actions">
      <slot />
    </div>
    <el-button v-if="rows" link size="small" @click="listVisible = true">查看已选</el-button>
    <el-button link size="small" @click="emit('clear')">清空选择</el-button>

    <el-dialog v-model="listVisible" title="已选清单" width="520px" append-to-body>
      <p class="admin-batch-bar__hint">
        列表以选中时数据为准，状态可能已变更（提交时以服务端为准）
      </p>
      <ul class="admin-batch-bar__list">
        <li v-for="row in rows" :key="row.id" class="admin-batch-bar__item">
          <span class="admin-batch-bar__item-id">#{{ row.id }}</span>
          <span class="admin-batch-bar__item-label" :title="rowLabel?.(row)">
            {{ rowLabel?.(row) ?? '' }}
          </span>
          <el-button link type="danger" size="small" @click="emit('remove', row)">移除</el-button>
        </li>
      </ul>
    </el-dialog>
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

.admin-batch-bar__hint {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.admin-batch-bar__list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 50vh;
  overflow-y: auto;
}

.admin-batch-bar__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
}

.admin-batch-bar__item:last-child {
  border-bottom: none;
}

.admin-batch-bar__item-id {
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.admin-batch-bar__item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
