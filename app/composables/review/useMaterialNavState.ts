import type { ReviewMaterialItem } from '#shared/types/review'

/**
 * 材料复习导航状态机
 * - 接受 getList getter，兼容页面中 materialList 异步加载的场景
 * - 完成态：currentIndex 越过 length，current 为 null
 */
export function useMaterialNavState(getList: () => ReviewMaterialItem[]) {
  const currentIndex = ref(0)
  const isCompleted = computed(() => currentIndex.value >= getList().length)
  const current = computed<ReviewMaterialItem | null>(() =>
    isCompleted.value ? null : getList()[currentIndex.value]!,
  )

  function next() {
    if (isCompleted.value) return
    currentIndex.value++
  }

  function prev() {
    if (currentIndex.value <= 0) return
    currentIndex.value--
  }

  function reset() {
    currentIndex.value = 0
  }

  return { currentIndex, isCompleted, current, next, prev, reset }
}
