import { getFavWordIds, toggleFavWord, getFavSegmentIds, toggleFavSegment } from '~/api/user'

/**
 * 用户收藏管理 composable
 * 管理单词和片段的收藏状态，使用 Set 实现 O(1) 查找
 */
export const useFavorites = () => {
  const favWordIds = ref<Set<number>>(new Set())
  const favSegmentIds = ref<Set<number>>(new Set())
  const wordsLoaded = ref(false)
  const segmentsLoaded = ref(false)
  const togglingWord = ref<number | null>(null)
  const togglingSegment = ref<number | null>(null)

  /** 拉取收藏单词列表 */
  async function fetchFavWords() {
    if (wordsLoaded.value) return
    const res = await getFavWordIds()
    if (res?.code === 200 && res.data) {
      favWordIds.value = new Set(res.data)
    }
    wordsLoaded.value = true
  }

  /** 拉取收藏片段列表 */
  async function fetchFavSegments() {
    if (segmentsLoaded.value) return
    const res = await getFavSegmentIds()
    if (res?.code === 200 && res.data) {
      favSegmentIds.value = new Set(res.data)
    }
    segmentsLoaded.value = true
  }

  /** 切换单词收藏状态 */
  async function toggleWord(vocabularyId: number) {
    if (togglingWord.value === vocabularyId) return
    togglingWord.value = vocabularyId

    // 乐观更新
    const prev = new Set(favWordIds.value)
    if (favWordIds.value.has(vocabularyId)) {
      favWordIds.value.delete(vocabularyId)
    } else {
      favWordIds.value.add(vocabularyId)
    }

    const res = await toggleFavWord(vocabularyId)

    if (res?.code === 200 && res.data) {
      // 以服务端结果为准
      if (res.data.isFav) {
        favWordIds.value.add(vocabularyId)
      } else {
        favWordIds.value.delete(vocabularyId)
      }
    } else {
      // 失败回滚
      favWordIds.value = prev
    }

    togglingWord.value = null
    return res
  }

  /** 切换片段收藏状态 */
  async function toggleSegment(segmentId: number) {
    if (togglingSegment.value === segmentId) return
    togglingSegment.value = segmentId

    // 乐观更新
    const prev = new Set(favSegmentIds.value)
    if (favSegmentIds.value.has(segmentId)) {
      favSegmentIds.value.delete(segmentId)
    } else {
      favSegmentIds.value.add(segmentId)
    }

    const res = await toggleFavSegment(segmentId)

    if (res?.code === 200 && res.data) {
      if (res.data.isFav) {
        favSegmentIds.value.add(segmentId)
      } else {
        favSegmentIds.value.delete(segmentId)
      }
    } else {
      favSegmentIds.value = prev
    }

    togglingSegment.value = null
    return res
  }

  /** 检查单词是否已收藏 */
  function isWordFav(vocabularyId: number): boolean {
    return favWordIds.value.has(vocabularyId)
  }

  /** 检查片段是否已收藏 */
  function isSegmentFav(segmentId: number): boolean {
    return favSegmentIds.value.has(segmentId)
  }

  return {
    favWordIds,
    favSegmentIds,
    fetchFavWords,
    fetchFavSegments,
    toggleWord,
    toggleSegment,
    isWordFav,
    isSegmentFav,
    togglingWord,
    togglingSegment,
  }
}