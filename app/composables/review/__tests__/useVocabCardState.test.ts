import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useVocabCardState } from '../useVocabCardState'
import type { ReviewVocabItem } from '#shared/types/review'

// 3 个假数据，覆盖可选字段为 null 与有值两种情况
const mockList: ReviewVocabItem[] = [
  {
    id: 1,
    segmentId: 1,
    word: 'apple',
    phonetic: 'ˈæp.əl',
    meaning: '苹果',
    forms: 'apples',
    exampleSentence: 'I like apples.',
    exampleTranslation: '我喜欢苹果。',
    audioUrl: null,
  },
  {
    id: 2,
    segmentId: 1,
    word: 'banana',
    phonetic: null,
    meaning: '香蕉',
    forms: null,
    exampleSentence: null,
    exampleTranslation: null,
    audioUrl: 'https://example.com/b.ogg',
  },
  {
    id: 3,
    segmentId: 1,
    word: 'cherry',
    phonetic: 'ˈtʃer.i',
    meaning: '樱桃',
    forms: 'cherries',
    exampleSentence: 'A cherry is red.',
    exampleTranslation: '樱桃是红色的。',
    audioUrl: null,
  },
]

// 用 getter 形式传入，模拟页面中 vocabList 是 ref 的场景
function makeState(list: ReviewVocabItem[] = mockList) {
  const vocabList = ref(list)
  return { vocabList, ...useVocabCardState(() => vocabList.value) }
}

describe('useVocabCardState', () => {
  it('初始状态：currentIndex=0, isFlipped=false, isCompleted=false', () => {
    const { currentIndex, isFlipped, isCompleted, currentWord } = makeState()
    expect(currentIndex.value).toBe(0)
    expect(isFlipped.value).toBe(false)
    expect(isCompleted.value).toBe(false)
    // ref 会将数组元素包装为 reactive proxy，引用不再 ===，故用深度相等
    expect(currentWord.value).toEqual(mockList[0])
  })

  it('toggleFlip：正面→背面；再调一次→正面', () => {
    const { isFlipped, toggleFlip } = makeState()
    expect(isFlipped.value).toBe(false)
    toggleFlip()
    expect(isFlipped.value).toBe(true)
    toggleFlip()
    expect(isFlipped.value).toBe(false)
  })

  it('markKnown：currentIndex++ 且 isFlipped 重置为 false', () => {
    const { currentIndex, isFlipped, toggleFlip, markKnown } = makeState()
    toggleFlip()
    expect(isFlipped.value).toBe(true)
    markKnown()
    expect(currentIndex.value).toBe(1)
    expect(isFlipped.value).toBe(false)
  })

  it('markKnown 到最后一个后再调一次：isCompleted=true, currentWord=null', () => {
    const { currentIndex, isCompleted, currentWord, markKnown } = makeState()
    markKnown() // 0 -> 1
    markKnown() // 1 -> 2
    expect(currentIndex.value).toBe(2)
    expect(isCompleted.value).toBe(false)
    markKnown() // 2 -> 3 (= length)
    expect(currentIndex.value).toBe(3)
    expect(isCompleted.value).toBe(true)
    expect(currentWord.value).toBe(null)
  })

  it('markUnknown 正面时：isFlipped=true，currentIndex 不变', () => {
    const { currentIndex, isFlipped, markUnknown } = makeState()
    expect(isFlipped.value).toBe(false)
    markUnknown()
    expect(isFlipped.value).toBe(true)
    expect(currentIndex.value).toBe(0)
  })

  it('markUnknown 背面时：isFlipped 保持 true，currentIndex 不变', () => {
    const { currentIndex, isFlipped, markUnknown } = makeState()
    markUnknown() // 翻到背面
    expect(isFlipped.value).toBe(true)
    markUnknown() // 背面再调
    expect(isFlipped.value).toBe(true)
    expect(currentIndex.value).toBe(0)
  })

  it('next：行为同 markKnown', () => {
    const { currentIndex, isFlipped, toggleFlip, next } = makeState()
    toggleFlip()
    next()
    expect(currentIndex.value).toBe(1)
    expect(isFlipped.value).toBe(false)
    next()
    expect(currentIndex.value).toBe(2)
    next()
    expect(currentIndex.value).toBe(3)
  })

  it('reset：currentIndex=0, isFlipped=false', () => {
    const { currentIndex, isFlipped, toggleFlip, markKnown, reset } = makeState()
    toggleFlip()
    markKnown()
    expect(currentIndex.value).toBe(1)
    expect(isFlipped.value).toBe(false)
    toggleFlip()
    reset()
    expect(currentIndex.value).toBe(0)
    expect(isFlipped.value).toBe(false)
  })

  it('完成态下调用任何方法都不改变状态', () => {
    const { currentIndex, isFlipped, isCompleted, markKnown, markUnknown, toggleFlip, reset } = makeState()
    // 推到完成态
    markKnown()
    markKnown()
    markKnown()
    expect(isCompleted.value).toBe(true)
    expect(currentIndex.value).toBe(3)

    markKnown()
    expect(currentIndex.value).toBe(3)
    expect(isFlipped.value).toBe(false)

    markUnknown()
    expect(isFlipped.value).toBe(false)
    expect(currentIndex.value).toBe(3)

    toggleFlip()
    expect(isFlipped.value).toBe(false)

    // reset 不属于"已完成下的导航"，应能复活
    reset()
    expect(currentIndex.value).toBe(0)
    expect(isFlipped.value).toBe(false)
  })
})
