import type { ReviewVocabItem } from '#shared/types/review'

/**
 * 单词翻转卡片状态机
 * - 接受 getList getter，兼容页面中 vocabList 异步加载的场景
 * - 完成态：currentIndex 越过 length，currentWord 为 null
 */
export function useVocabCardState(getList: () => ReviewVocabItem[]) {
  const currentIndex = ref(0)
  const isFlipped = ref(false)
  const isCompleted = computed(() => currentIndex.value >= getList().length)

  const currentWord = computed<ReviewVocabItem | null>(() =>
    isCompleted.value ? null : getList()[currentIndex.value]!,
  )

  /** 点击卡片本体：切换正反面 */
  function toggleFlip() {
    if (!isCompleted.value) isFlipped.value = !isFlipped.value
  }

  /** 认识：进入下一个，重置为正面 */
  function markKnown() {
    if (isCompleted.value) return
    currentIndex.value++
    isFlipped.value = false
  }

  /** 不认识：正面→翻背面；背面→保持不变 */
  function markUnknown() {
    if (isCompleted.value) return
    if (!isFlipped.value) isFlipped.value = true
  }

  /** → 箭头：同认识 */
  function next() {
    markKnown()
  }

  /** ← 箭头：上一个 */
  function prev() {
    if (currentIndex.value <= 0) return
    currentIndex.value--
    isFlipped.value = false
  }

  /** 再来一轮 */
  function reset() {
    currentIndex.value = 0
    isFlipped.value = false
  }

  return {
    currentIndex,
    isFlipped,
    isCompleted,
    currentWord,
    toggleFlip,
    markKnown,
    markUnknown,
    next,
    prev,
    reset,
  }
}
