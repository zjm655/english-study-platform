import { describe, it, expect } from 'vitest'
import { compareTextSimilarity } from '../textSimilarity'

describe('compareTextSimilarity', () => {
  it('完全相同的文本返回 score=1, passed=true', () => {
    const result = compareTextSimilarity('Hello world', 'Hello world')
    expect(result.score).toBe(1)
    expect(result.passed).toBe(true)
  })

  it('大小写差异标准化后相同，返回 score=1', () => {
    const result = compareTextSimilarity('Hello World', 'hello world')
    expect(result.score).toBe(1)
    expect(result.passed).toBe(true)
  })

  it('标点差异去除后相同，返回 score=1', () => {
    const result = compareTextSimilarity('Hello, world!', 'hello world')
    expect(result.score).toBe(1)
    expect(result.passed).toBe(true)
  })

  it('完全不同的文本返回 score=0, passed=false', () => {
    const result = compareTextSimilarity('the cat sat on the mat', 'dogs run quickly in parks')
    expect(result.score).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('部分重叠的文本返回 0~1 之间的分数', () => {
    const result = compareTextSimilarity(
      'the quick brown fox jumps over the lazy dog',
      'the quick brown fox sleeps on the floor',
    )
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(1)
  })

  it('空文本返回 score=0, passed=false', () => {
    const result = compareTextSimilarity('', 'hello world')
    expect(result.score).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('两个空文本返回 score=0, passed=false', () => {
    const result = compareTextSimilarity('', '')
    expect(result.score).toBe(0)
    expect(result.passed).toBe(false)
  })

  it('自定义阈值高于实际分数时 passed=false', () => {
    const result = compareTextSimilarity('hello world', 'hello there', 0.9)
    expect(result.score).toBeLessThan(0.9)
    expect(result.passed).toBe(false)
  })

  it('多句长文本相似度计算正确', () => {
    const original =
      'The morning sun cast long shadows across the garden. Birds sang in the tall trees.'
    const recognized =
      'The morning sun cast long shadows across the garden. Birds sang in the trees.'
    const result = compareTextSimilarity(original, recognized)
    expect(result.score).toBeGreaterThan(0.8)
    expect(result.passed).toBe(true)
  })
})
