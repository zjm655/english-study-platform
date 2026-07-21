import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EvaluationResultCard from '../EvaluationResultCard.vue'
import type { Recording } from '#shared/types/recording'

const mockRecording: Recording = {
  id: 1,
  userId: 1,
  segmentId: 1,
  phase: 3,
  audioPath: 'https://example.com/a.ogg',
  score: 75,
  feedback: '整体表现良好，发音基本准确，可以进一步优化语调。',
  recognizedText: 'hello world',
  wordScores: [
    { word: 'hello', score: 90, status: 'correct' },
    { word: 'world', score: 50, status: 'wrong' },
  ],
  rawResult: null,
  duration: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('EvaluationResultCard 逐词评分渲染', () => {
  it('wordScores 有数据时逐词渲染并带状态颜色类', () => {
    const wrapper = mount(EvaluationResultCard, {
      props: { recording: mockRecording, referenceText: 'hello world' },
    })
    const words = wrapper.findAll('.word-score')
    expect(words.length).toBe(2)
    expect(words[0]!.text()).toBe('hello')
    expect(words[0]!.classes()).toContain('word--correct')
    expect(words[1]!.text()).toBe('world')
    expect(words[1]!.classes()).toContain('word--wrong')
  })

  it('四种状态映射到对应颜色类', () => {
    const recording: Recording = {
      ...mockRecording,
      wordScores: [
        { word: 'a', score: 85, status: 'correct' },
        { word: 'b', score: 65, status: 'minor' },
        { word: 'c', score: 45, status: 'wrong' },
        { word: 'd', score: 10, status: 'missing' },
      ],
    }
    const wrapper = mount(EvaluationResultCard, {
      props: { recording, referenceText: 'a b c d' },
    })
    const words = wrapper.findAll('.word-score')
    expect(words.map((w) => w.text())).toEqual(['a', 'b', 'c', 'd'])
    expect(words[0]!.classes()).toContain('word--correct')
    expect(words[1]!.classes()).toContain('word--minor')
    expect(words[2]!.classes()).toContain('word--wrong')
    expect(words[3]!.classes()).toContain('word--missing')
  })

  it('wordScores 为空数组时不渲染逐词项', () => {
    const wrapper = mount(EvaluationResultCard, {
      props: { recording: { ...mockRecording, wordScores: [] }, referenceText: 'hello' },
    })
    expect(wrapper.findAll('.word-score').length).toBe(0)
  })

  it('wordScores 为 null 时不渲染逐词项（不报错）', () => {
    const wrapper = mount(EvaluationResultCard, {
      props: { recording: { ...mockRecording, wordScores: null }, referenceText: 'hello' },
    })
    expect(wrapper.findAll('.word-score').length).toBe(0)
  })

  it('渲染综合评分与 AI 评价', () => {
    const wrapper = mount(EvaluationResultCard, {
      props: { recording: mockRecording, referenceText: 'hello world' },
    })
    expect(wrapper.find('.score-number').text()).toBe('75')
    expect(wrapper.find('.feedback-text').text()).toContain('整体表现良好')
  })
})
