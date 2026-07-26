import { ref, shallowRef, computed } from 'vue'

/** el-table 实例最小接口（只用到 clearSelection，避免耦合 Element Plus 类型） */
interface SelectableTable {
  clearSelection: () => void
}

/**
 * 管理后台表格多选状态（el-table type="selection" 配套）：
 * 模板上 ref="tableRef" + @selection-change="onSelectionChange"，
 * clear() 同步清空 el-table 复选框与本地状态（批量操作后/手动清空共用）。
 * 不做跨页保留选择（选择范围有界 = 批量上限有界）。
 * shallowRef：整组替换即可，规避 ref 深层 UnwrapRef 对泛型行类型的推导干扰。
 */
export const useTableSelection = <T extends { id: number }>() => {
  const tableRef = ref<SelectableTable | null>(null)
  const selectedRows = shallowRef<T[]>([])

  const selectedIds = computed(() => selectedRows.value.map((row) => row.id))

  function onSelectionChange(rows: T[]) {
    selectedRows.value = rows
  }

  function clear() {
    tableRef.value?.clearSelection()
    selectedRows.value = []
  }

  return { tableRef, selectedRows, selectedIds, onSelectionChange, clear }
}
