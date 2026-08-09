import { toastWarning } from '~/utils/popup'

/** el-table 实例最小接口（clearSelection + toggleRowSelection，避免耦合 Element Plus 类型；
 *  表级 toggleRowSelection 的 ignoreSelectable 默认 true，达限置灰行也能被 API 取消） */
interface SelectableTable {
  clearSelection: () => void
  toggleRowSelection: (row: unknown, selected?: boolean) => void
}

export interface UseTableSelectionOptions<T> {
  /** 选中上限（缺省不限制）：达限后 canSelect 对未选行返回 false（已选行豁免以便取消勾选） */
  limit?: number
  /** 当前页数据 getter：供 offPageCount 计算「含其他页 M 项」 */
  pageRows?: () => readonly T[]
}

/**
 * 管理后台表格多选状态（el-table type="selection" 配套，支持跨页保留）：
 * 模板上 ref="tableRef" + @selection-change="onSelectionChange" + selection 列加
 * `reserve-selection`（配合 row-key，翻页/整刷替换数据时 EP store 按 id 保留选中，
 * selection-change 报告的是含其他页行的全量选中集）。
 * clear() 同步清空 el-table 复选框（含跨页保留行）与本地状态。
 *
 * 约定：
 * - 选中状态活在组件实例内，离开页面即销毁——无跨路由残留（勿改造成 Pinia store，
 *   跨路由存活的选中集有「集合有但 UI 未显示」的幽灵选中安全风险）；
 *   若将来 admin 布局引入 keep-alive，需补 onDeactivated(clear)。
 * - 筛选/搜索/重置变更时调用方必须 clear()（被筛掉的选中行不可见，保留即幽灵选中）。
 * - canSelect 只按 row.id 判断（重载后行对象是新引用；跨页行经 EP store 路径 index=-1，
 *   selectable 实现不得依赖 index 参数）。
 * - 当前为显式行对象模式；将来若需「按筛选条件全量选择」（如选中全部 3000 条导出），
 *   应走服务端按条件批量端点 + BatchBar slot 加入口，而非扩张本 composable 的选中集。
 *
 * shallowRef：整组替换即可，规避 ref 深层 UnwrapRef 对泛型行类型的推导干扰。
 */
export const useTableSelection = <T extends { id: number }>(
  options: UseTableSelectionOptions<T> = {},
) => {
  const limit = options.limit ?? Infinity
  const tableRef = ref<SelectableTable | null>(null)
  const selectedRows = shallowRef<T[]>([])

  const selectedIds = computed(() => selectedRows.value.map((row) => row.id))
  const selectedIdSet = computed(() => new Set(selectedIds.value))

  /** selection 列 :selectable：达限禁续选，已选行豁免（否则达限后无法取消勾选） */
  function canSelect(row: T): boolean {
    return selectedIdSet.value.has(row.id) || selectedRows.value.length < limit
  }

  /** 选中集中不在当前页的行数（批量条「含其他页 M 项」文案） */
  const offPageCount = computed(() => {
    const onPage = new Set((options.pageRows?.() ?? []).map((r) => r.id))
    return selectedRows.value.filter((r) => !onPage.has(r.id)).length
  })

  function onSelectionChange(rows: T[]) {
    // 表头全选溢出裁剪：EP 的 _toggleAllSelection 循环期间逐行调 selectable，
    // 但本地计数要等循环结束的一次 selection-change 才更新——接近上限时全选会超额。
    // 对超额尾部逐行 toggle off 后 return：toggle 触发的下一轮 selection-change
    // 长度单调递减自然收敛，无需重入标志。
    if (rows.length > limit) {
      for (const row of rows.slice(limit)) {
        tableRef.value?.toggleRowSelection(row, false)
      }
      toastWarning(`最多选择 ${limit} 项，超出部分已自动取消`)
      return
    }
    selectedRows.value = rows
  }

  /** 已选清单弹层逐项移除：走表格 API 保持单一真相源
   *（EP 按 row-key 在 selection 内匹配，跨页行同样生效；selection-change 无条件回流同步本地） */
  function removeRow(row: T) {
    tableRef.value?.toggleRowSelection(row, false)
  }

  function clear() {
    tableRef.value?.clearSelection()
    selectedRows.value = []
  }

  return {
    tableRef,
    selectedRows,
    selectedIds,
    onSelectionChange,
    clear,
    canSelect,
    removeRow,
    offPageCount,
  }
}
