import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useMaterialNavState } from '../useMaterialNavState'
import type { ReviewMaterialItem } from '#shared/types/review'

const mockList: ReviewMaterialItem[] = [
  {
    id: 1,
    title: '材料一',
    audioUrl: 'https://example.com/a.ogg',
    questions: [{ question: 'Q1', options: ['A', 'B'], answer: 'A' }],
    duration: 30,
  },
  {
    id: 2,
    title: '材料二',
    audioUrl: null,
    questions: null,
    duration: null,
  },
  {
    id: 3,
    title: '材料三',
    audioUrl: 'https://example.com/c.ogg',
    questions: null,
    duration: 60,
  },
]

function makeState(list: ReviewMaterialItem[] = mockList) {
  const materialList = ref(list)
  return { materialList, ...useMaterialNavState(() => materialList.value) }
}

describe('useMaterialNavState', () => {
  it('初始状态：currentIndex=0, isCompleted=false, current=第一个', () => {
    const { currentIndex, isCompleted, current } = makeState()
    expect(currentIndex.value).toBe(0)
    expect(isCompleted.value).toBe(false)
    expect(current.value).toEqual(mockList[0])
  })

  it('next：currentIndex++', () => {
    const { currentIndex, current, next } = makeState()
    next()
    expect(currentIndex.value).toBe(1)
    expect(current.value).toEqual(mockList[1])
  })

  it('next 到最后一个后再 next：isCompleted=true, current=null', () => {
    const { currentIndex, isCompleted, current, next } = makeState()
    next() // 0 -> 1
    next() // 1 -> 2
    expect(currentIndex.value).toBe(2)
    expect(isCompleted.value).toBe(false)
    next() // 2 -> 3 (= length)
    expect(currentIndex.value).toBe(3)
    expect(isCompleted.value).toBe(true)
    expect(current.value).toBe(null)
  })

  it('reset：currentIndex=0', () => {
    const { currentIndex, reset, next } = makeState()
    next()
    next()
    expect(currentIndex.value).toBe(2)
    reset()
    expect(currentIndex.value).toBe(0)
  })

  it('空列表：初始即 isCompleted=true', () => {
    const { currentIndex, isCompleted, current } = makeState([])
    expect(currentIndex.value).toBe(0)
    expect(isCompleted.value).toBe(true)
    expect(current.value).toBe(null)
  })
})
