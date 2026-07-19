import { describe, it, expect } from 'vitest'
import { diffRecognized } from '~/utils/wordDiff'

describe('diffRecognized', () => {
  it('全部匹配时所有 token 标记为 match', () => {
    const ref = 'Hello my name is Tom'
    const rec = 'hello my name is tom'
    const result = diffRecognized(rec, ref)
    expect(result).toHaveLength(5)
    expect(result.every((t) => t.match)).toBe(true)
  })

  it('归一化：忽略大小写与标点', () => {
    const ref = 'This is my friend Lily.'
    const rec = 'This is my friend, Lily!'
    const result = diffRecognized(rec, ref)
    expect(result.every((t) => t.match)).toBe(true)
  })

  it('识别文本多出的词标记为 mismatch', () => {
    const ref = 'I am a boy'
    const rec = 'I am a big boy'
    const result = diffRecognized(rec, ref)
    const mismatched = result.filter((t) => !t.match).map((t) => t.word)
    expect(mismatched).toContain('big')
    expect(result.filter((t) => t.match)).toHaveLength(4)
  })

  it('保留原始 token 形态用于展示', () => {
    const result = diffRecognized('Tom!', 'Tom')
    expect(result[0]!.word).toBe('Tom!')
    expect(result[0]!.match).toBe(true)
  })

  it('识别文本为空返回空数组', () => {
    expect(diffRecognized('', 'anything')).toEqual([])
  })

  it('参考原文为空时识别 token 全部 mismatch', () => {
    const result = diffRecognized('hello world', '')
    expect(result).toHaveLength(2)
    expect(result.every((t) => !t.match)).toBe(true)
  })
})
