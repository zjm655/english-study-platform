import { describe, it, expect } from 'vitest'
import { rowToRecording } from '../recording'
import type { RecordingRow } from '#server/types/db'

function makeRow(overrides: Partial<RecordingRow> = {}): RecordingRow {
  return {
    id: 1,
    user_id: 1,
    segment_id: 1,
    phase: 3,
    audioPath: null,
    media_id: null,
    score: '92.00',
    feedback: '整体表现优秀',
    recognizedText: 'hello world',
    wordScores: null,
    rawResult: null,
    duration: '5.00',
    createdAt: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('rowToRecording wordScores 解析', () => {
  it('mysql2 已将 json 列解析为数组时直接使用（不再二次 JSON.parse）', () => {
    const arr = [
      { word: 'hello', score: 100, status: 'correct' as const },
      { word: 'world', score: 50, status: 'wrong' as const },
    ]
    const rec = rowToRecording(makeRow({ wordScores: arr }))
    expect(rec?.wordScores).toEqual(arr)
  })

  it('兼容 JSON 字符串形态（历史/手动写入数据）', () => {
    const json = JSON.stringify([{ word: 'hi', score: 80, status: 'correct' }])
    const rec = rowToRecording(makeRow({ wordScores: json }))
    expect(rec?.wordScores).toEqual([{ word: 'hi', score: 80, status: 'correct' }])
  })

  it('wordScores 为 null 时返回 null', () => {
    const rec = rowToRecording(makeRow({ wordScores: null }))
    expect(rec?.wordScores).toBeNull()
  })

  it('非法 JSON 字符串时降级为 null（不抛错）', () => {
    // 模拟旧 bug：对已解析数组误用 JSON.parse 会得到 "[object Object]"
    const rec = rowToRecording(makeRow({ wordScores: '[object Object]' }))
    expect(rec?.wordScores).toBeNull()
  })

  it('audioPathOverride 优先于 row.audioPath', () => {
    const rec = rowToRecording(makeRow({ audioPath: 'raw-key' }), 'https://signed/url')
    expect(rec?.audioPath).toBe('https://signed/url')
  })

  it('score/duration 由 decimal 字符串转为 number', () => {
    const rec = rowToRecording(makeRow({ score: '92.00', duration: '5.00' }))
    expect(rec?.score).toBe(92)
    expect(rec?.duration).toBe(5)
  })

  it('row 为 undefined 时返回 null', () => {
    expect(rowToRecording(undefined)).toBeNull()
  })
})
